import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  InlineGrid,
  EmptyState,
  Button,
  Banner,
  Box,
  TextField,
  Icon,
  Divider,
} from "@shopify/polaris";
import { SearchIcon, XIcon } from "@shopify/polaris-icons";
import { Fragment, useEffect, useState } from "react";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { getShopSettings } from "../utils/plan.server";
import { PLANS, CATEGORY_PLAN, type Plan } from "../utils/plan";
import { humanizeField, humanizeValue, friendlySummary } from "../utils/humanize";

const prisma = new PrismaClient();

const SORT_KEYS = ["type", "event", "who", "when"] as const;
type SortKey = (typeof SORT_KEYS)[number];

function orderByFor(sort: SortKey, dir: "asc" | "desc"): any {
  if (sort === "type") return { category: dir };
  if (sort === "who") return { staffName: dir };
  if (sort === "event") return { summary: dir };
  return { createdAt: dir };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getShopSettings(shop);
  const url = new URL(request.url);

  const category = url.searchParams.get("category") || "";
  const staff = url.searchParams.get("staff") || "";
  const q = url.searchParams.get("q") || "";

  // Sorting
  const rawSort = url.searchParams.get("sort") as SortKey | null;
  const sort: SortKey = rawSort && SORT_KEYS.includes(rawSort) ? rawSort : "when";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  // Clamp the days filter to the plan's retention. Merchants on Free cant meaningfully
  // pick Last 90 days because nothing older than 10 is retained. Show a banner in that case.
  const requestedDays = Number(url.searchParams.get("days") || String(settings.retentionDays));
  const effectiveDays = Math.min(requestedDays, settings.retentionDays);

  const since = new Date();
  since.setDate(since.getDate() - effectiveDays);

  const where: any = { shop, createdAt: { gte: since } };
  if (category) where.category = category;
  if (staff) where.staffName = { contains: staff, mode: "insensitive" };
  if (q) {
    where.OR = [
      { summary: { contains: q, mode: "insensitive" } },
      { resourceTitle: { contains: q, mode: "insensitive" } },
    ];
  }

  const [events, totalEvents, distinctStaff] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: orderByFor(sort, dir as "asc" | "desc"),
      take: 100,
    }),
    prisma.auditEvent.count({ where: { shop } }),
    prisma.auditEvent.findMany({
      where: { shop, staffName: { not: null } },
      select: { staffName: true },
      distinct: ["staffName"],
      take: 20,
    }),
  ]);

  return json({
    events: events.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
    totalEvents,
    staffOptions: distinctStaff.map((s) => s.staffName).filter(Boolean) as string[],
    settings: {
      plan: settings.plan,
      retentionDays: settings.retentionDays,
    },
    planLabel: PLANS[(settings.plan as Plan) || "free"].label,
    filters: {
      category,
      staff,
      q,
      requestedDays,
      effectiveDays,
      clamped: requestedDays > effectiveDays,
    },
    sort: { key: sort, dir },
  });
};

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Only categories actually subscribed in shopify.app.toml for v1.0.
// order, customer, draft_order, fulfillment are deferred to v1.1 pending
// Shopify protected-customer-data approval.
const CATEGORY_META: Record<string, { tone: any; label: string }> = {
  product: { tone: "success", label: "Product" },
  inventory: { tone: "attention", label: "Inventory" },
  collection: { tone: "new", label: "Collection" },
  theme: { tone: "warning", label: "Theme" },
  shop: { tone: "critical", label: "Shop" },
  app: { tone: undefined, label: "App" },
};

export default function TimelinePage() {
  const { events, totalEvents, staffOptions, settings, planLabel, filters, sort } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Local state for the search box. Commit to URL on submit / blur so we dont
  // reload on every keystroke.
  const [searchInput, setSearchInput] = useState<string>(filters.q);
  useEffect(() => setSearchInput(filters.q), [filters.q]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const clearAllFilters = () => {
    const next = new URLSearchParams();
    if (filters.requestedDays !== settings.retentionDays) {
      next.set("days", String(filters.requestedDays));
    }
    // keep the current sort when clearing filters
    if (sort.key !== "when") next.set("sort", sort.key);
    if (sort.dir !== "desc") next.set("dir", sort.dir);
    setSearchParams(next, { replace: true });
  };

  const sortColumnIndex = SORT_KEYS.indexOf(sort.key as SortKey);
  const sortDirection = sort.dir === "asc" ? "ascending" : "descending";

  const onSort = (index: number, direction: "ascending" | "descending") => {
    const next = new URLSearchParams(searchParams);
    next.set("sort", SORT_KEYS[index]);
    next.set("dir", direction === "ascending" ? "asc" : "desc");
    setSearchParams(next, { replace: true });
  };

  const rows = events.map((e, i) => {
    const meta = CATEGORY_META[e.category] || { tone: undefined, label: e.category };

    // diffJson is stored as a string so we have to parse each time. If it ever
    // fails (bad webhook payload, schema drift) fall back to an empty list so
    // the row still renders the summary cleanly.
    let parsedDiff: Array<{ field: string; before: unknown; after: unknown }> = [];
    try {
      const raw = JSON.parse(e.diffJson || "[]");
      if (Array.isArray(raw)) parsedDiff = raw;
    } catch {
      parsedDiff = [];
    }

    // For inventory_levels events, the diff the old webhook handler stored is
    // empty, but rawJson has the `available` count. Pull it so the rebuilt
    // summary can say "set inventory to N units" instead of just "updated
    // inventory". New rows are already recorded with a proper diff entry.
    let inventoryAvailable: number | null = null;
    if (e.topic.startsWith("inventory_levels")) {
      try {
        const raw = JSON.parse(e.rawJson || "{}");
        if (typeof raw.available === "number") inventoryAvailable = raw.available;
      } catch {
        /* ignore */
      }
    }

    // Rebuild the summary client-side for display. This handles old rows that
    // were recorded before the server-side summary was humanized. For rows
    // where we can't derive anything cleaner, fall back to the stored summary.
    const rebuilt = friendlySummary({
      topic: e.topic,
      staffName: e.staffName,
      resourceTitle: e.resourceTitle,
      diff: parsedDiff,
      inventoryAvailable,
    });
    const displaySummary = rebuilt || e.summary;

    return (
      <IndexTable.Row id={e.id} key={e.id} position={i}>
        <IndexTable.Cell>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="200">
            <Text as="span" variant="bodyMd">{displaySummary}</Text>

            {parsedDiff.length > 0 && (
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  <InlineGrid
                    columns={["oneThird", "oneThird", "oneThird"]}
                    gap="200"
                  >
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      What changed
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      Before
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      After
                    </Text>
                  </InlineGrid>
                  <Divider />
                  {parsedDiff.map((d, idx) => (
                    <Fragment key={idx}>
                      <InlineGrid
                        columns={["oneThird", "oneThird", "oneThird"]}
                        gap="200"
                      >
                        <Text as="span" variant="bodySm" fontWeight="medium">
                          {humanizeField(d.field)}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {humanizeValue(d.field, d.before)}
                        </Text>
                        <Text as="span" variant="bodySm">
                          {humanizeValue(d.field, d.after)}
                        </Text>
                      </InlineGrid>
                    </Fragment>
                  ))}
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {e.staffName || "A staff member"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">{relativeTime(e.createdAt)}</Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  // Only show time-range chips up to the plan retention. Capping them
  // avoids showing merchants ranges that will always return empty.
  const allDayOptions = [
    { label: "Last 24 hours", value: "1" },
    { label: "Last 7 days", value: "7" },
    { label: "Last 10 days", value: "10" },
    { label: "Last 30 days", value: "30" },
    { label: "Last 90 days", value: "90" },
    { label: "Last year", value: "365" },
  ];
  const daysOptions = allDayOptions.filter((o) => Number(o.value) <= settings.retentionDays);

  const categoryOptions = [
    { label: "All categories", value: "", gated: false },
    ...Object.entries(CATEGORY_META).map(([k, v]) => ({
      label: v.label,
      value: k,
      gated:
        CATEGORY_PLAN[k] &&
        CATEGORY_PLAN[k] !== "free" &&
        !(
          settings.plan === "premium" ||
          (settings.plan === "paid" && CATEGORY_PLAN[k] === "paid")
        ),
    })),
  ];

  const anyFilter = filters.category || filters.staff || filters.q;

  const exportHref = `/app/export?${new URLSearchParams({
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.staff ? { staff: filters.staff } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    days: String(filters.effectiveDays),
  }).toString()}`;

  return (
    <Page
      title="Activity timeline"
      subtitle={`${totalEvents} total events tracked on this store`}
      primaryAction={{
        content: "Export CSV",
        // Polaris Page primaryAction passes `external` straight to the <a>.
        // Omit it entirely so React doesn't warn about a non-boolean attribute,
        // and the browser triggers the Content-Disposition: attachment download.
        url: exportHref,
      }}
      secondaryActions={[{ content: "Settings", url: "/app/settings" }]}
    >
      <BlockStack gap="400">
        {settings.plan === "free" && (
          <Banner title={`You are on the ${planLabel} plan`} tone="info">
            <Text as="p">
              Tracking products and inventory changes. {settings.retentionDays}-day history.
            </Text>
            <Box paddingBlockStart="200">
              <Link to="/app/settings">
                Upgrade to track collections, themes and shop settings, and keep a full year of history.
              </Link>
            </Box>
          </Banner>
        )}

        {filters.clamped && (
          <Banner tone="warning">
            <Text as="p">
              Your {planLabel} plan stores the last {settings.retentionDays} days. Older events are not retained.
              Showing the last {filters.effectiveDays} days.{" "}
              <Link to="/app/settings">Upgrade for longer retention.</Link>
            </Text>
          </Banner>
        )}

        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="300">
              <InlineStack gap="200" wrap align="space-between">
                <InlineStack gap="200" wrap>
                  {daysOptions.map((opt) => (
                    <Button
                      key={opt.value}
                      pressed={String(filters.effectiveDays) === opt.value}
                      onClick={() => setParam("days", opt.value)}
                      size="slim"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </InlineStack>
                {anyFilter && (
                  <Button
                    size="slim"
                    variant="tertiary"
                    icon={XIcon}
                    onClick={clearAllFilters}
                  >
                    Clear filters
                  </Button>
                )}
              </InlineStack>

              <InlineStack gap="200" wrap>
                {categoryOptions.map((opt) => (
                  <Button
                    key={opt.value || "all"}
                    pressed={filters.category === opt.value}
                    onClick={() => setParam("category", opt.value || null)}
                    size="slim"
                    variant="tertiary"
                    disabled={!!opt.gated}
                  >
                    {opt.label}{opt.gated ? " (upgrade)" : ""}
                  </Button>
                ))}
              </InlineStack>

              <InlineStack gap="300" wrap>
                <Box minWidth="240px">
                  <TextField
                    label="Search events"
                    labelHidden
                    prefix={<Icon source={SearchIcon} />}
                    placeholder="Search by product, order, or event detail"
                    value={searchInput}
                    onChange={setSearchInput}
                    onBlur={() => setParam("q", searchInput || null)}
                    clearButton
                    onClearButtonClick={() => {
                      setSearchInput("");
                      setParam("q", null);
                    }}
                    autoComplete="off"
                  />
                </Box>

                {/* Staff filter is gated behind Pro. On Free it just shows a disabled hint. */}
                {settings.plan === "free" ? (
                  <Box>
                    <Button disabled size="slim" variant="tertiary">
                      Filter by staff (upgrade)
                    </Button>
                  </Box>
                ) : staffOptions.length > 0 ? (
                  <InlineStack gap="100" wrap>
                    <Text as="span" variant="bodySm" tone="subdued">Staff:</Text>
                    <Button
                      size="slim"
                      variant="tertiary"
                      pressed={!filters.staff}
                      onClick={() => setParam("staff", null)}
                    >
                      Anyone
                    </Button>
                    {staffOptions.map((name) => (
                      <Button
                        key={name}
                        size="slim"
                        variant="tertiary"
                        pressed={filters.staff === name}
                        onClick={() => setParam("staff", name)}
                      >
                        {name}
                      </Button>
                    ))}
                  </InlineStack>
                ) : null}
              </InlineStack>
            </BlockStack>
          </Box>

          {events.length === 0 ? (
            anyFilter ? (
              <EmptyState
                heading="No events match these filters"
                action={{ content: "Clear filters", onAction: clearAllFilters }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Try widening the date range or clearing the category filter.</p>
              </EmptyState>
            ) : (
              <EmptyState
                heading="Your store is quiet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Make a change in your Shopify admin (edit a product, update inventory) and it will
                  appear here within a few seconds.
                </p>
              </EmptyState>
            )
          ) : (
            <IndexTable
              resourceName={{ singular: "event", plural: "events" }}
              itemCount={events.length}
              selectable={false}
              headings={[
                { title: "Type" },
                { title: "Event" },
                { title: "Who" },
                { title: "When" },
              ]}
              sortable={[true, true, true, true]}
              sortColumnIndex={sortColumnIndex >= 0 ? sortColumnIndex : 3}
              sortDirection={sortDirection}
              onSort={onSort}
              defaultSortDirection="descending"
            >
              {rows}
            </IndexTable>
          )}
        </Card>

        {settings.plan === "free" && (
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            Free plan exports include the last 7 days.{" "}
            <Link to="/app/settings">Upgrade for full-history CSV export.</Link>
          </Text>
        )}
      </BlockStack>
    </Page>
  );
}
