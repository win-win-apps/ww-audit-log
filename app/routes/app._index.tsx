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
  Banner,
  Box,
  TextField,
  Icon,
  Thumbnail,
} from "@shopify/polaris";
import { SearchIcon, XIcon } from "@shopify/polaris-icons";
import { useEffect, useMemo, useState } from "react";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { getShopSettings } from "../utils/plan.server";
import { PLANS, UNLIMITED_RETENTION, isUnlimited, normalisePlan, type Plan } from "../utils/plan";
import { humanizeField, humanizeValue } from "../utils/humanize";

const prisma = new PrismaClient();

const SORT_KEYS = [
  "type",
  "item",
  "what",
  "before",
  "after",
  "who",
  "when",
] as const;
type SortKey = (typeof SORT_KEYS)[number];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getShopSettings(shop);
  const url = new URL(request.url);

  const category = url.searchParams.get("category") || "";
  const staff = url.searchParams.get("staff") || "";
  const q = url.searchParams.get("q") || "";

  // Sorting. We fetch events ordered by createdAt desc (newest first) so we
  // always retrieve the freshest 100 regardless of UI sort. Column-level sort
  // is applied client-side after flattening, so columns like "Before" / "After"
  // (which aren't DB columns) can sort too.
  const rawSort = url.searchParams.get("sort") as SortKey | null;
  const sort: SortKey = rawSort && SORT_KEYS.includes(rawSort) ? rawSort : "when";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  // Clamp the days filter to the plan's retention. Merchants on Free cant meaningfully
  // pick Last 90 days because nothing older than 3 is retained. Show a banner in that case.
  // Paid plans have "unlimited" retention (sentinel value), so the clamp only bites on Free.
  const defaultDays = Math.min(settings.retentionDays, 30);
  const requestedDays = Number(url.searchParams.get("days") || String(defaultDays));
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
      orderBy: { createdAt: "desc" },
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
      plan: normalisePlan(settings.plan),
      retentionDays: settings.retentionDays,
      unlimited: isUnlimited(settings.retentionDays),
    },
    planLabel: PLANS[normalisePlan(settings.plan)].label,
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

// Every category we know how to record. Mirrors CATEGORY_PLAN in plan.ts.
// Polaris Badge tones: success, attention, new, warning, critical, info,
// magic, read-only. We use them as a rough palette — not meant to carry
// semantic weight beyond "merchants can tell rows apart at a glance".
const CATEGORY_META: Record<string, { tone: any; label: string }> = {
  product: { tone: "success", label: "Product" },
  inventory: { tone: "attention", label: "Inventory" },
  collection: { tone: "new", label: "Collection" },
  theme: { tone: "warning", label: "Theme" },
  shop: { tone: "critical", label: "Shop" },
  app: { tone: undefined, label: "App" },
  order: { tone: "info", label: "Order" },
  draft_order: { tone: "info", label: "Draft order" },
  fulfillment: { tone: "success", label: "Fulfillment" },
  refund: { tone: "critical", label: "Refund" },
  customer: { tone: "magic", label: "Customer" },
  discount: { tone: "attention", label: "Discount" },
  location: { tone: "new", label: "Location" },
  file: { tone: undefined, label: "File" },
  market: { tone: "warning", label: "Market" },
  domain: { tone: "critical", label: "Domain" },
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

  // Flatten events into one row per field change. An event with 3 diff entries
  // produces 3 rows (all sharing Who / When / Type). Events with no diff
  // (creates, deletes, updates with no captured diff) produce one row with an
  // action phrase in "What changed" and empty Before / After.
  type Row = {
    id: string;
    category: string;
    itemLabel: string;
    thumbnail: string | null;
    whatChanged: string;
    before: string;
    after: string;
    staffName: string | null;
    createdAt: string;
    sortBefore: string;
    sortAfter: string;
  };

  const flat: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const e of events) {
      let parsedDiff: Array<{ field: string; before: unknown; after: unknown }> = [];
      try {
        const raw = JSON.parse(e.diffJson || "[]");
        if (Array.isArray(raw)) parsedDiff = raw;
      } catch { /* ignore */ }

      // Pull the thumbnail URL out of rawJson. For products the webhook
      // payload carries `image.src` and `images[0].src`; either works.
      let thumbnail: string | null = null;
      try {
        const raw = JSON.parse(e.rawJson || "{}");
        thumbnail =
          raw?.image?.src ||
          raw?.featured_image?.src ||
          raw?.images?.[0]?.src ||
          null;

        // Old inventory rows have no diff entry but rawJson holds the count.
        if (
          parsedDiff.length === 0 &&
          e.topic.startsWith("inventory_levels") &&
          typeof raw?.available === "number"
        ) {
          parsedDiff = [{ field: "inventory", before: null, after: raw.available }];
        }
      } catch { /* ignore */ }

      // Inventory items dont have a human name in the payload, so the stored
      // resourceTitle is "Inventory item 47831...". Hide that from the UI.
      const isInventoryPlaceholder =
        e.resourceTitle?.startsWith("Inventory item ") ?? false;
      const itemLabel = isInventoryPlaceholder
        ? ""
        : e.resourceTitle || "";

      if (parsedDiff.length > 0) {
        parsedDiff.forEach((d, idx) => {
          out.push({
            id: `${e.id}:${idx}`,
            category: e.category,
            itemLabel,
            thumbnail,
            whatChanged: humanizeField(d.field),
            before: humanizeValue(d.field, d.before),
            after: humanizeValue(d.field, d.after),
            staffName: e.staffName,
            createdAt: e.createdAt,
            sortBefore: String(d.before ?? ""),
            sortAfter: String(d.after ?? ""),
          });
        });
      } else {
        // No diff. Describe the action instead.
        let action = "Updated";
        if (e.topic.endsWith("/create")) action = "Created";
        else if (e.topic.endsWith("/delete")) action = "Deleted";
        out.push({
          id: e.id,
          category: e.category,
          itemLabel,
          thumbnail,
          whatChanged: action,
          before: "",
          after: "",
          staffName: e.staffName,
          createdAt: e.createdAt,
          sortBefore: "",
          sortAfter: "",
        });
      }
    }
    return out;
  }, [events]);

  const sortedRows = useMemo(() => {
    const copy = [...flat];
    const mult = sort.dir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      switch (sort.key) {
        case "type":
          return a.category.localeCompare(b.category) * mult;
        case "item":
          return a.itemLabel.localeCompare(b.itemLabel) * mult;
        case "what":
          return a.whatChanged.localeCompare(b.whatChanged) * mult;
        case "before":
          return a.sortBefore.localeCompare(b.sortBefore, undefined, {
            numeric: true,
          }) * mult;
        case "after":
          return a.sortAfter.localeCompare(b.sortAfter, undefined, {
            numeric: true,
          }) * mult;
        case "who":
          return (a.staffName || "").localeCompare(b.staffName || "") * mult;
        case "when":
        default:
          return (
            (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
            mult
          );
      }
    });
    return copy;
  }, [flat, sort.key, sort.dir]);

  const rows = sortedRows.map((r, i) => {
    const meta = CATEGORY_META[r.category] || { tone: undefined, label: r.category };
    return (
      <IndexTable.Row id={r.id} key={r.id} position={i}>
        <IndexTable.Cell>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {r.itemLabel ? (
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              {r.thumbnail ? (
                <Thumbnail
                  source={r.thumbnail}
                  alt={r.itemLabel}
                  size="extraSmall"
                />
              ) : null}
              <Text as="span" variant="bodyMd">{r.itemLabel}</Text>
            </InlineStack>
          ) : (
            <Text as="span" variant="bodySm" tone="subdued">
              {""}
            </Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">{r.whatChanged}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {r.before || ""}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {r.after || ""}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {r.staffName || "A staff member"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {relativeTime(r.createdAt)}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  // Only show time-range chips up to the plan retention. Capping them
  // avoids showing merchants ranges that will always return empty.
  // Paid = unlimited, so every option is available. Free = 3 days, so
  // only the shortest window survives the filter.
  const allDayOptions = [
    { label: "Last 24 hours", value: "1" },
    { label: "Last 3 days", value: "3" },
    { label: "Last 7 days", value: "7" },
    { label: "Last 30 days", value: "30" },
    { label: "Last 90 days", value: "90" },
    { label: "Last year", value: "365" },
    { label: "All time", value: String(UNLIMITED_RETENTION) },
  ];
  const daysOptions = allDayOptions.filter((o) => Number(o.value) <= settings.retentionDays);

  // No category gating anymore. Every plan can see every category.
  const categoryOptions = [
    { label: "All categories", value: "" },
    ...Object.entries(CATEGORY_META).map(([k, v]) => ({
      label: v.label,
      value: k,
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
              Tracking every admin action on your store. Free keeps a {settings.retentionDays} day rolling window.
            </Text>
            <Box paddingBlockStart="200">
              <Link to="/app/billing">
                Upgrade to Paid for unlimited history and backfill up to a year of past events.
              </Link>
            </Box>
          </Banner>
        )}

        {filters.clamped && (
          <Banner tone="warning">
            <Text as="p">
              Your {planLabel} plan stores the last {settings.retentionDays} days. Older events are not retained.
              Showing the last {filters.effectiveDays} days.{" "}
              <Link to="/app/billing">Upgrade for unlimited retention.</Link>
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
                  >
                    {opt.label}
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

                {/* Staff filter is always on now. Both plans get full filtering. */}
                {staffOptions.length > 0 ? (
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
              resourceName={{ singular: "change", plural: "changes" }}
              itemCount={sortedRows.length}
              selectable={false}
              headings={[
                { title: "Type" },
                { title: "Item" },
                { title: "What changed" },
                { title: "Before" },
                { title: "After" },
                { title: "Who" },
                { title: "When" },
              ]}
              sortable={[true, true, true, true, true, true, true]}
              sortColumnIndex={sortColumnIndex >= 0 ? sortColumnIndex : 6}
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
            Free keeps the last {settings.retentionDays} days. CSV export matches the visible window.{" "}
            <Link to="/app/billing">Upgrade for unlimited history and backfill.</Link>
          </Text>
        )}
      </BlockStack>
    </Page>
  );
}
