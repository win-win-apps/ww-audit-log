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
  EmptyState,
  Button,
  ChoiceList,
  Filters,
  useIndexResourceState,
  Banner,
  Box,
} from "@shopify/polaris";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { getShopSettings, PLANS, type Plan } from "../utils/plan.server";

const prisma = new PrismaClient();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getShopSettings(shop);
  const url = new URL(request.url);

  const category = url.searchParams.get("category") || "";
  const staff = url.searchParams.get("staff") || "";
  const q = url.searchParams.get("q") || "";
  const days = Number(url.searchParams.get("days") || "30");

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: any = { shop, createdAt: { gte: since } };
  if (category) where.category = category;
  if (staff) where.staffName = { contains: staff, mode: "insensitive" };
  if (q) {
    where.OR = [
      { summary: { contains: q, mode: "insensitive" } },
      { resourceTitle: { contains: q, mode: "insensitive" } },
    ];
  }

  const [events, totalEvents, categoryCounts] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.auditEvent.count({ where: { shop } }),
    prisma.auditEvent.groupBy({
      by: ["category"],
      where: { shop, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  return json({
    events: events.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
    totalEvents,
    categoryCounts,
    settings: {
      plan: settings.plan,
      retentionDays: settings.retentionDays,
    },
    planLabel: PLANS[(settings.plan as Plan) || "free"].label,
    filters: { category, staff, q, days },
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

const CATEGORY_META: Record<string, { tone: any; label: string }> = {
  product: { tone: "success", label: "Product" },
  inventory: { tone: "attention", label: "Inventory" },
  order: { tone: "info", label: "Order" },
  collection: { tone: "new", label: "Collection" },
  customer: { tone: "magic", label: "Customer" },
  draft_order: { tone: "info", label: "Draft order" },
  theme: { tone: "warning", label: "Theme" },
  fulfillment: { tone: "info", label: "Fulfillment" },
  shop: { tone: "critical", label: "Shop" },
  app: { tone: undefined, label: "App" },
};

export default function TimelinePage() {
  const { events, totalEvents, settings, planLabel, filters } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const resourceName = { singular: "event", plural: "events" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(
    events as any,
  );

  const rows = events.map((e, i) => {
    const meta = CATEGORY_META[e.category] || { tone: undefined, label: e.category };
    return (
      <IndexTable.Row id={e.id} key={e.id} position={i}>
        <IndexTable.Cell>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">{e.summary}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">{e.staffName || "—"}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">{relativeTime(e.createdAt)}</Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const daysOptions = [
    { label: "Last 24 hours", value: "1" },
    { label: "Last 7 days", value: "7" },
    { label: "Last 30 days", value: "30" },
    { label: "Last 90 days", value: "90" },
    { label: "Last year", value: "365" },
  ];

  const categoryOptions = [
    { label: "All", value: "" },
    ...Object.entries(CATEGORY_META).map(([k, v]) => ({ label: v.label, value: k })),
  ];

  return (
    <Page
      title="Activity timeline"
      subtitle={`${totalEvents} total events tracked on this store`}
      primaryAction={{ content: "Export CSV", url: `/app/export?${new URLSearchParams(filters as any).toString()}`, external: true }}
      secondaryActions={[{ content: "Settings", url: "/app/settings" }]}
    >
      <BlockStack gap="400">
        {settings.plan === "free" && (
          <Banner title={`You are on the ${planLabel} plan`} tone="info">
            <Text as="p">Tracking products, inventory, and orders. 30-day history.</Text>
            <Box paddingBlockStart="200">
              <Link to="/app/settings">Upgrade to track collections, customers, themes, and keep a full year of history.</Link>
            </Box>
          </Banner>
        )}
        <Card padding="0">
          <Box padding="400">
            <InlineStack gap="300" wrap>
              {daysOptions.map((opt) => (
                <Button
                  key={opt.value}
                  pressed={String(filters.days) === opt.value}
                  onClick={() => setParam("days", opt.value)}
                  size="slim"
                >
                  {opt.label}
                </Button>
              ))}
            </InlineStack>
            <Box paddingBlockStart="300">
              <InlineStack gap="200" wrap>
                {categoryOptions.map((opt) => (
                  <Button
                    key={opt.value || "all"}
                    pressed={filters.category === opt.value}
                    onClick={() => setParam("category", opt.value || null)}
                    size="slim"
                    variant="tertiary"
                  >
                    {opt.label}
                  </Button>
                ))}
              </InlineStack>
            </Box>
          </Box>
          {events.length === 0 ? (
            <EmptyState
              heading="Your store is quiet"
              action={{ content: "Change something in admin", url: "shopify://admin/products", external: true }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Make a change in your Shopify admin (edit a product, update inventory) and it will appear here within a few seconds.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={resourceName}
              itemCount={events.length}
              selectable={false}
              headings={[
                { title: "Type" },
                { title: "Event" },
                { title: "Who" },
                { title: "When" },
              ]}
            >
              {rows}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
