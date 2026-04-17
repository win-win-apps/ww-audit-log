import { PrismaClient } from "@prisma/client";
import { trimRaw } from "./audit.server";

const prisma = new PrismaClient();

// Shopify retains events for 1 year. Anything older than this is not
// returnable through the Admin API. We cap the backfill window to match.
const MAX_LOOKBACK_YEARS = 1;

// Per-run safety cap so a single request doesn't hang forever on a huge store.
// 20 pages of 250 events = 5000 events max per backfill. Merchants with more
// history than that are unusual at our price point; we can raise later.
const MAX_PAGES_PER_RUN = 20;
const PAGE_SIZE = 250;

// Map a Shopify events subjectType (ProductVariant, Order, Customer, ...) onto
// our internal audit category. Subject types we don't track get bucketed into
// "app" with an explanatory topic so merchants can still see them on the
// timeline without us having to add a new category tone.
export function mapSubjectToCategory(subjectType: string | null | undefined): string {
  switch ((subjectType || "").toUpperCase()) {
    case "PRODUCT":
    case "PRODUCTVARIANT":
    case "PRODUCT_VARIANT":
      return "product";
    case "COLLECTION":
      return "collection";
    case "ORDER":
      return "order";
    case "DRAFTORDER":
    case "DRAFT_ORDER":
      return "draft_order";
    case "CUSTOMER":
      return "customer";
    case "SHOP":
      return "shop";
    case "THEME":
      return "theme";
    case "REFUND":
      return "refund";
    case "FULFILLMENT":
      return "fulfillment";
    case "PRICERULE":
    case "PRICE_RULE":
    case "DISCOUNTCODE":
      return "discount";
    case "LOCATION":
      return "location";
    case "ONLINESTOREARTICLE":
    case "ONLINESTOREPAGE":
    case "ONLINESTOREBLOG":
    case "METAOBJECT":
      return "file";
    case "MARKET":
      return "market";
    case "DOMAIN":
      return "domain";
    default:
      return "app";
  }
}

interface RunBackfillArgs {
  shop: string;
  installedAt: Date;
  // admin.graphql from authenticate.admin(request)
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
}

interface RunBackfillResult {
  inserted: number;
  pagesFetched: number;
  hitCap: boolean;
  fromDate: string;
  toDate: string;
}

// Pulls historical events from Shopify's Admin API for the window
// [installedAt - 1 year, installedAt) and inserts them as AuditEvent rows
// with createdAt mirroring Shopify's event timestamps. Returns summary stats.
export async function runBackfill(args: RunBackfillArgs): Promise<RunBackfillResult> {
  const now = new Date();
  const oneYearBack = new Date(now);
  oneYearBack.setFullYear(oneYearBack.getFullYear() - MAX_LOOKBACK_YEARS);

  // If the shop installed more than a year ago (unlikely but possible) cap to
  // installedAt so we don't try to fetch events that predate the 1 year window.
  const from = args.installedAt > oneYearBack ? oneYearBack : args.installedAt;
  // Backfill STOPS at install time; later events are captured by webhooks.
  const to = args.installedAt;

  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const query = `
    query BackfillEvents($first: Int!, $after: String, $query: String!) {
      events(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: false) {
        nodes {
          id
          createdAt
          message
          appTitle
          attributeToApp
          attributeToUser
          ... on BasicEvent {
            action
            arguments
            subjectId
            subjectType
            additionalContent
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  let cursor: string | null = null;
  let pagesFetched = 0;
  let inserted = 0;
  let hitCap = false;

  // We build one giant list of records then insert with createMany so a slow
  // merchant DB doesn't have to round trip per row.
  const rows: Array<{
    shop: string;
    category: string;
    topic: string;
    resourceId: string | null;
    resourceTitle: string | null;
    staffId: string | null;
    staffName: string | null;
    summary: string;
    diffJson: string;
    rawJson: string;
    createdAt: Date;
  }> = [];

  while (pagesFetched < MAX_PAGES_PER_RUN) {
    const response = await args.graphql(query, {
      variables: {
        first: PAGE_SIZE,
        after: cursor,
        // Shopify's query language uses `created_at:>=...` and `<...` ranges.
        query: `created_at:>=${fromIso} created_at:<${toIso}`,
      },
    });

    const body: any = await response.json();
    pagesFetched += 1;

    const payload = body?.data?.events;
    if (!payload) {
      // Malformed response. Surface the error back to the caller.
      const errMsg =
        body?.errors?.[0]?.message || "Shopify returned no events payload";
      throw new Error(`Backfill page ${pagesFetched} failed: ${errMsg}`);
    }

    for (const node of payload.nodes || []) {
      const subjectType: string = node.subjectType || "";
      const category = mapSubjectToCategory(subjectType);
      // Topic string follows the same slash style as webhook topics so the
      // UI's action detection ("created"/"deleted") still works.
      const action = (node.action || "update").toLowerCase();
      const topic = `${category}/${action}`;

      const resourceId = node.subjectId || null;
      // Shopify doesn't return specific staff for historical events. Use the
      // app that performed the action as the attribution, falling back to a
      // generic label.
      const staffName = node.appTitle || "User action (backfilled)";

      rows.push({
        shop: args.shop,
        category,
        topic,
        resourceId,
        resourceTitle: null,
        staffId: null,
        staffName,
        summary: node.message || `${category} ${action}`,
        diffJson: "[]",
        rawJson: trimRaw(
          {
            backfilled: true,
            shopifyEventId: node.id,
            appTitle: node.appTitle,
            attributeToApp: node.attributeToApp,
            attributeToUser: node.attributeToUser,
            arguments: node.arguments,
            additionalContent: node.additionalContent,
            subjectType: node.subjectType,
            subjectId: node.subjectId,
          },
          true,
        ),
        createdAt: new Date(node.createdAt),
      });
    }

    if (!payload.pageInfo?.hasNextPage) break;
    cursor = payload.pageInfo.endCursor || null;
    if (!cursor) break;

    if (pagesFetched >= MAX_PAGES_PER_RUN) {
      hitCap = true;
      break;
    }
  }

  // Chunk the insert so we don't blow the Postgres parameter limit on big shops.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const result = await prisma.auditEvent.createMany({ data: batch });
    inserted += result.count;
  }

  return {
    inserted,
    pagesFetched,
    hitCap,
    fromDate: fromIso,
    toDate: toIso,
  };
}
