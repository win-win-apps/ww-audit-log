import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  DataTable,
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
  Thumbnail,
  Divider,
  Popover,
  OptionList,
  ChoiceList,
  DatePicker,
} from "@shopify/polaris";
import {
  SearchIcon,
  XIcon,
  RefreshIcon,
  CalendarIcon,
} from "@shopify/polaris-icons";
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

  // Date range. Two modes:
  //   preset: ?days=30 (or any of our preset day values)
  //   custom: ?from=2026-04-01&to=2026-04-17 (inclusive, YYYY-MM-DD)
  // Custom wins when both from and to parse as valid dates.
  const rawFrom = url.searchParams.get("from") || "";
  const rawTo = url.searchParams.get("to") || "";
  const parsedFrom = rawFrom ? new Date(rawFrom) : null;
  const parsedTo = rawTo ? new Date(rawTo) : null;
  const usingCustom =
    parsedFrom !== null && !isNaN(parsedFrom.getTime()) &&
    parsedTo !== null && !isNaN(parsedTo.getTime());

  const defaultDays = Math.min(settings.retentionDays, 30);
  const requestedDays = Number(url.searchParams.get("days") || String(defaultDays));
  const effectiveDays = Math.min(requestedDays, settings.retentionDays);

  let since: Date;
  let until: Date;
  let clamped = false;
  if (usingCustom) {
    since = new Date(parsedFrom!);
    since.setHours(0, 0, 0, 0);
    until = new Date(parsedTo!);
    until.setHours(23, 59, 59, 999);

    // Clamp to plan retention if the user asked for events older than we keep.
    if (!isUnlimited(settings.retentionDays)) {
      const earliest = new Date();
      earliest.setDate(earliest.getDate() - settings.retentionDays);
      earliest.setHours(0, 0, 0, 0);
      if (since < earliest) {
        since = earliest;
        clamped = true;
      }
    }
  } else {
    since = new Date();
    since.setDate(since.getDate() - effectiveDays);
    until = new Date();
    clamped = requestedDays > effectiveDays;
  }

  const where: any = { shop, createdAt: { gte: since, lte: until } };
  if (category) where.category = category;
  if (staff) where.staffName = { contains: staff, mode: "insensitive" };
  if (q) {
    where.OR = [
      { summary: { contains: q, mode: "insensitive" } },
      { resourceTitle: { contains: q, mode: "insensitive" } },
    ];
  }

  const [events, totalEvents, distinctStaff, windowEventCount] = await Promise.all([
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
    // Full count for the filtered window so the summary row reflects the real
    // total, not just the 100 we render.
    prisma.auditEvent.count({ where }),
  ]);

  return json({
    events: events.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
    totalEvents,
    windowEventCount,
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
      clamped,
      mode: usingCustom ? ("custom" as const) : ("preset" as const),
      fromIso: since.toISOString(),
      toIso: until.toISOString(),
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

function shortClockTime(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  const { events, totalEvents, windowEventCount, staffOptions, settings, planLabel, filters, sort } =
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

  // Summary stats for the top-of-table "Summary" row. Shopify reports show a
  // bold totals row with aggregates for the current window; we do the same
  // with counts that make sense for an audit log (events, unique items,
  // unique staff, categories touched).
  const summary = useMemo(() => {
    const uniqueItems = new Set(
      sortedRows.map((r) => r.itemLabel).filter((v) => v && v.length > 0),
    ).size;
    const uniqueStaff = new Set(
      sortedRows.map((r) => r.staffName || "").filter((v) => v.length > 0),
    ).size;
    const uniqueCategories = new Set(sortedRows.map((r) => r.category)).size;
    return {
      visibleRows: sortedRows.length,
      items: uniqueItems,
      staff: uniqueStaff,
      categories: uniqueCategories,
    };
  }, [sortedRows]);

  // Most recent event drives the "Last refreshed" clock in the header. If the
  // store has never generated an event this just shows "Never".
  const lastRefreshedIso = events[0]?.createdAt || null;
  const lastRefreshed = shortClockTime(lastRefreshedIso);

  // Pretty label for the active window, used in the summary card. Custom
  // ranges render as "Custom"; presets get a human label.
  const windowLabel =
    filters.mode === "custom"
      ? "Custom"
      : isUnlimited(filters.effectiveDays)
        ? "All time"
        : filters.effectiveDays === 1
          ? "Last 24 hours"
          : filters.effectiveDays === 365
            ? "Last year"
            : `Last ${filters.effectiveDays} days`;

  // DataTable accepts ReactNodes in each cell so we can still render Badges
  // and thumbnails inside a native report-style table.
  const tableRows: React.ReactNode[][] = sortedRows.map((r) => {
    const meta = CATEGORY_META[r.category] || { tone: undefined, label: r.category };
    return [
      <Badge key={`type-${r.id}`} tone={meta.tone}>{meta.label}</Badge>,
      r.itemLabel ? (
        <InlineStack key={`item-${r.id}`} gap="200" blockAlign="center" wrap={false}>
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
        <Text key={`item-${r.id}`} as="span" tone="subdued">
          {""}
        </Text>
      ),
      <Text key={`what-${r.id}`} as="span" variant="bodyMd">
        {r.whatChanged}
      </Text>,
      <Text key={`before-${r.id}`} as="span" variant="bodySm" tone="subdued">
        {r.before || ""}
      </Text>,
      <Text key={`after-${r.id}`} as="span" variant="bodySm">
        {r.after || ""}
      </Text>,
      <Text key={`who-${r.id}`} as="span" variant="bodySm" tone="subdued">
        {r.staffName || "A staff member"}
      </Text>,
      <Text key={`when-${r.id}`} as="span" variant="bodySm" tone="subdued">
        {relativeTime(r.createdAt)}
      </Text>,
    ];
  });

  // No category gating anymore. Every plan can see every category.
  const categoryOptions = [
    { label: "All categories", value: "" },
    ...Object.entries(CATEGORY_META).map(([k, v]) => ({
      label: v.label,
      value: k,
    })),
  ];

  const anyFilter = filters.category || filters.staff || filters.q;

  // CSV export uses the same window as the view. For custom ranges we pass
  // from/to; for presets we pass days.
  const exportParams = new URLSearchParams({
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.staff ? { staff: filters.staff } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  });
  if (filters.mode === "custom") {
    exportParams.set("from", filters.fromIso.slice(0, 10));
    exportParams.set("to", filters.toIso.slice(0, 10));
  } else {
    exportParams.set("days", String(filters.effectiveDays));
  }
  const exportHref = `/app/export?${exportParams.toString()}`;

  return (
    <Page fullWidth>
      <BlockStack gap="400">
        {/* Report-style header: title + last refreshed + actions, mirrors the
            top of a native Shopify analytics report. */}
        <InlineStack align="space-between" blockAlign="start" wrap>
          <BlockStack gap="100">
            <InlineStack gap="300" blockAlign="center" wrap>
              <Text as="h1" variant="headingXl">
                Activity report
              </Text>
              <InlineStack gap="100" blockAlign="center">
                <Icon source={RefreshIcon} tone="subdued" />
                <Text as="span" variant="bodySm" tone="subdued">
                  Last refreshed: {lastRefreshed}
                </Text>
              </InlineStack>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {totalEvents.toLocaleString()} total events tracked on this store
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            <Link to="/app/settings">
              <Button variant="tertiary">Settings</Button>
            </Link>
            <Link to="/app/billing">
              <Button variant="tertiary">Billing</Button>
            </Link>
            <a href={exportHref}>
              <Button variant="primary">Export CSV</Button>
            </a>
          </InlineStack>
        </InlineStack>

        {/* Chip row: date pills on the left, plan pill + filter-count on the
            right. Mirrors the "Last year / Jan 1-Dec 31 / CAD $" row in the
            native Shopify report. */}
        <InlineStack gap="200" wrap align="space-between" blockAlign="center">
          <InlineStack gap="200" wrap blockAlign="center">
            <DateRangePill
              mode={filters.mode}
              fromIso={filters.fromIso}
              toIso={filters.toIso}
              effectiveDays={filters.effectiveDays}
              maxDays={settings.retentionDays}
              onApplyPreset={(days) => {
                const next = new URLSearchParams(searchParams);
                next.set("days", String(days));
                next.delete("from");
                next.delete("to");
                setSearchParams(next, { replace: true });
              }}
              onApplyCustom={(fromYmd, toYmd) => {
                const next = new URLSearchParams(searchParams);
                next.delete("days");
                next.set("from", fromYmd);
                next.set("to", toYmd);
                setSearchParams(next, { replace: true });
              }}
            />
            <Button size="slim" disabled>
              {planLabel} plan
            </Button>
          </InlineStack>
          {(anyFilter || filters.mode === "custom") && (
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

        {filters.clamped && (
          <Banner tone="warning">
            <Text as="p">
              Your {planLabel} plan stores the last {settings.retentionDays} days. Older events are not retained.
              Showing the last {filters.effectiveDays} days.{" "}
              <Link to="/app/billing">Upgrade for unlimited retention.</Link>
            </Text>
          </Banner>
        )}

        {/* Two-column layout: main content on the left, filters sidebar on the
            right. Matches the native report layout where Metrics/Dimensions/
            Filters live in a right-aligned card. */}
        <InlineGrid
          columns={{ xs: "1fr", lg: "1fr 300px" }}
          gap="400"
        >
          <BlockStack gap="400">
            {/* Summary row that mirrors the bold "Summary" row at the top of a
                Shopify report. Small labels on top, large numbers underneath. */}
            <Card padding="0">
              <Box padding="400">
                <InlineStack gap="800" wrap blockAlign="start">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Window
                    </Text>
                    <Text as="p" variant="headingLg">
                      {windowLabel}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {windowEventCount.toLocaleString()} events
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Total changes
                    </Text>
                    <Text as="p" variant="headingLg">
                      {summary.visibleRows.toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      across shown rows
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Items affected
                    </Text>
                    <Text as="p" variant="headingLg">
                      {summary.items.toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      unique resources
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Staff members
                    </Text>
                    <Text as="p" variant="headingLg">
                      {summary.staff.toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      who made edits
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Categories
                    </Text>
                    <Text as="p" variant="headingLg">
                      {summary.categories.toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      touched
                    </Text>
                  </BlockStack>
                </InlineStack>
              </Box>
            </Card>

            {/* The table itself, rendered as a DataTable so we get the
                spreadsheet feel of a native Shopify report (no row selection
                checkboxes, no hover highlight bar). */}
            <Card padding="0">
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
                <>
                  <Box paddingInline="400" paddingBlockStart="400" paddingBlockEnd="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Changes
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Showing {sortedRows.length.toLocaleString()} of {windowEventCount.toLocaleString()}
                      </Text>
                    </InlineStack>
                  </Box>
                  <Divider />
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "Type",
                      "Item",
                      "What changed",
                      "Before",
                      "After",
                      "Who",
                      "When",
                    ]}
                    rows={tableRows}
                    sortable={[true, true, true, true, true, true, true]}
                    initialSortColumnIndex={sortColumnIndex >= 0 ? sortColumnIndex : 6}
                    defaultSortDirection={sortDirection}
                    onSort={onSort}
                    hoverable
                    truncate
                  />
                </>
              )}
            </Card>

            {settings.plan === "free" && (
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                Free keeps the last {settings.retentionDays} days. CSV export matches the visible window.{" "}
                <Link to="/app/billing">Upgrade for unlimited history and backfill.</Link>
              </Text>
            )}
          </BlockStack>

          {/* Right sidebar: the native Shopify report puts Metrics / Dimensions
              / Filters in a card on the right. We don't have metrics or a
              grouping dimension for event rows, so we mirror just the Filters
              section. */}
          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingSm">
                Filters
              </Text>

              <BlockStack gap="150">
                <Text as="p" variant="bodySm" tone="subdued">
                  Search
                </Text>
                <TextField
                  label="Search events"
                  labelHidden
                  prefix={<Icon source={SearchIcon} />}
                  placeholder="Search product, order, or detail"
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
              </BlockStack>

              <Divider />

              <BlockStack gap="150">
                <ChoiceList
                  title="Category"
                  choices={categoryOptions.map((o) => ({
                    label: o.label,
                    value: o.value,
                  }))}
                  selected={[filters.category]}
                  onChange={(vals) => setParam("category", vals[0] || null)}
                />
              </BlockStack>

              {staffOptions.length > 0 && (
                <>
                  <Divider />
                  <BlockStack gap="150">
                    <ChoiceList
                      title="Staff"
                      choices={[
                        { label: "Anyone", value: "" },
                        ...staffOptions.map((name) => ({ label: name, value: name })),
                      ]}
                      selected={[filters.staff]}
                      onChange={(vals) => setParam("staff", vals[0] || null)}
                    />
                  </BlockStack>
                </>
              )}

              {(anyFilter || filters.mode === "custom") && (
                <>
                  <Divider />
                  <Button
                    variant="tertiary"
                    icon={XIcon}
                    onClick={clearAllFilters}
                    fullWidth
                  >
                    Clear all filters
                  </Button>
                </>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}

// Format a date as "Apr 18" or "Apr 18, 2025" depending on whether the year
// matches the current year. Keeps the pill label short when the range is
// within the current year (which is the common case).
function formatShortDate(d: Date, opts: { alwaysYear?: boolean } = {}): string {
  const showYear = opts.alwaysYear || d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  });
}

// "Mar 18 - Apr 17, 2026" or "Dec 28, 2024 - Jan 3, 2025" across year boundary.
// Hyphen with spaces because the project rules forbid em-dashes and en-dashes
// render inconsistently across fonts.
function formatRangeLabel(from: Date, to: Date): string {
  const sameYear = from.getFullYear() === to.getFullYear();
  const thisYear = new Date().getFullYear();
  const currentYear = from.getFullYear() === thisYear && to.getFullYear() === thisYear;

  if (sameYear) {
    const f = formatShortDate(from, { alwaysYear: false });
    const t = formatShortDate(to, { alwaysYear: !currentYear });
    return `${f} - ${t}`;
  }
  return `${formatShortDate(from, { alwaysYear: true })} - ${formatShortDate(to, { alwaysYear: true })}`;
}

// YYYY-MM-DD slice, local time not UTC, so "today" really means today in the
// merchant's timezone.
function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface DateRangePillProps {
  mode: "preset" | "custom";
  fromIso: string;
  toIso: string;
  effectiveDays: number;
  maxDays: number;
  onApplyPreset: (days: number) => void;
  onApplyCustom: (fromYmd: string, toYmd: string) => void;
}

// Shopify-report-style date selector. Two pill buttons (preset name + date
// range) that share one popover. Popover has preset list on the left and a
// two-month calendar on the right with a range selection.
function DateRangePill({
  mode,
  fromIso,
  toIso,
  effectiveDays,
  maxDays,
  onApplyPreset,
  onApplyCustom,
}: DateRangePillProps) {
  const [open, setOpen] = useState(false);

  const fromDate = useMemo(() => new Date(fromIso), [fromIso]);
  const toDate = useMemo(() => new Date(toIso), [toIso]);

  // Preset definitions. Kept in sync with the loader's default windows so the
  // pill never produces a value the loader doesn't understand.
  const allPresets = [
    { label: "Last 24 hours", days: 1 },
    { label: "Last 3 days", days: 3 },
    { label: "Last 7 days", days: 7 },
    { label: "Last 30 days", days: 30 },
    { label: "Last 90 days", days: 90 },
    { label: "Last year", days: 365 },
    { label: "All time", days: UNLIMITED_RETENTION },
  ];
  const presets = allPresets.filter((p) => p.days <= maxDays);

  const currentPreset =
    mode === "custom" ? null : presets.find((p) => p.days === effectiveDays);
  const presetLabel =
    mode === "custom"
      ? "Custom"
      : currentPreset?.label ||
        (isUnlimited(effectiveDays) ? "All time" : `Last ${effectiveDays} days`);

  // Date picker local state. Seeded from the URL each time we open, so the
  // picker reflects whatever the loader resolved (including clamping).
  const [pickerMonth, setPickerMonth] = useState(() => ({
    month: fromDate.getMonth(),
    year: fromDate.getFullYear(),
  }));
  const [pickerRange, setPickerRange] = useState<{ start: Date; end: Date }>(() => ({
    start: fromDate,
    end: toDate,
  }));

  useEffect(() => {
    if (open) {
      setPickerRange({ start: fromDate, end: toDate });
      setPickerMonth({ month: fromDate.getMonth(), year: fromDate.getFullYear() });
    }
  }, [open, fromIso, toIso]);

  const handleApply = () => {
    onApplyCustom(toYmd(pickerRange.start), toYmd(pickerRange.end));
    setOpen(false);
  };

  const rangeLabel = formatRangeLabel(fromDate, toDate);

  const activator = (
    <InlineStack gap="100" blockAlign="center" wrap={false}>
      <Button
        size="slim"
        icon={CalendarIcon}
        disclosure={open ? "up" : "down"}
        onClick={() => setOpen((o) => !o)}
      >
        {presetLabel}
      </Button>
      <Button
        size="slim"
        disclosure={open ? "up" : "down"}
        onClick={() => setOpen((o) => !o)}
      >
        {rangeLabel}
      </Button>
    </InlineStack>
  );

  return (
    <Popover
      active={open}
      activator={activator}
      onClose={() => setOpen(false)}
      preferredAlignment="left"
      preferredPosition="below"
      fluidContent
    >
      <Box padding="200" minWidth="640px">
        <InlineStack gap="400" wrap={false} blockAlign="start">
          <Box minWidth="180px" paddingBlockStart="200">
            <OptionList
              options={presets.map((p) => ({
                value: String(p.days),
                label: p.label,
              }))}
              selected={currentPreset ? [String(currentPreset.days)] : []}
              onChange={(vals) => {
                const n = Number(vals[0]);
                if (!isNaN(n)) {
                  onApplyPreset(n);
                  setOpen(false);
                }
              }}
            />
          </Box>
          <Box>
            <BlockStack gap="300">
              <DatePicker
                month={pickerMonth.month}
                year={pickerMonth.year}
                selected={pickerRange}
                onChange={setPickerRange}
                onMonthChange={(month, year) => setPickerMonth({ month, year })}
                allowRange
                multiMonth
              />
              <InlineStack gap="200" align="end">
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={handleApply}>
                  Apply
                </Button>
              </InlineStack>
            </BlockStack>
          </Box>
        </InlineStack>
      </Box>
    </Popover>
  );
}
