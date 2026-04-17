// Pure helpers for turning raw webhook field paths + values into something a
// non-technical merchant can read. Shared between webhook handlers (for the
// stored summary) and the UI (for the detail panel + summary fallback on
// rows that were recorded before the server-side summary was cleaned up).

// Map of known field-path prefixes / keys to plain English.
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  status: "Status",
  vendor: "Vendor",
  product_type: "Product type",
  handle: "URL handle",
  body_html: "Description",
  tags: "Tags",
  price: "Price",
  compare_at_price: "Compare-at price",
  inventory: "Inventory",
  inventory_quantity: "Inventory",
  available: "Inventory",
  name: "Name",
};

// "Default Title" is Shopify's stand-in for a product that has only one
// variant. Merchants never see that label in the admin UI, so we drop it.
function isDefaultVariantLabel(v: string): boolean {
  return v === "Default Title" || v === "default_title" || /^\d+$/.test(v);
}

// Turn a raw diff field path into a merchant-friendly label.
// Examples:
//   "title" -> "Title"
//   "variant.Default Title.price" -> "Price"
//   "variant.Red / M.price" -> "Price (Red / M)"
//   "variant.Red / M.inventory" -> "Inventory (Red / M)"
export function humanizeField(field: string): string {
  if (!field) return "Field";
  const parts = field.split(".");

  // variant.{label}.{attr}
  if (parts[0] === "variant" && parts.length >= 3) {
    const variantLabel = parts.slice(1, parts.length - 1).join(".");
    const attr = parts[parts.length - 1];
    const attrLabel = FIELD_LABELS[attr] || titleCase(attr);
    if (isDefaultVariantLabel(variantLabel)) return attrLabel;
    return `${attrLabel} (${variantLabel})`;
  }

  // exact match
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];

  // fallback: title-case the final path segment
  return titleCase(parts[parts.length - 1]);
}

function titleCase(s: string): string {
  if (!s) return s;
  return s
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Format a diff value for display.
// Prices and compare-at-prices get a $ prefix (USD default). Inventory stays
// numeric. Empty strings, null, undefined get rendered as "empty" rather than
// a blank cell, so the "set from empty to X" case is clear.
export function humanizeValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "string" && value === "") return "empty";

  const isMoney = /price/i.test(field);
  if (isMoney) {
    const n = Number(value);
    if (isFinite(n)) {
      try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
      } catch {
        return `$${n.toFixed(2)}`;
      }
    }
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return "(unreadable)";
  }
}

// Build a plain-English summary from the stored event shape. Used in two
// places:
//   1. the webhook handlers, when recording a new event
//   2. the UI, as a fallback for events that were recorded before the server
//      summary was cleaned up (so existing rows still read nicely)
//
// topic is the lowercased slashy form, e.g. "products/update", "inventory_levels/update".
export function friendlySummary(opts: {
  topic: string;
  staffName?: string | null;
  resourceTitle?: string | null;
  diff?: Array<{ field: string; before: unknown; after: unknown }>;
  inventoryAvailable?: number | null;
}): string {
  const staff = opts.staffName || "A staff member";
  const title = opts.resourceTitle || "(untitled)";
  const topic = opts.topic || "";
  const diff = opts.diff || [];

  if (topic.endsWith("/create")) return `${staff} created ${title}`;
  if (topic.endsWith("/delete")) return `${staff} deleted ${title}`;

  if (topic.startsWith("inventory_levels")) {
    if (typeof opts.inventoryAvailable === "number") {
      const unit = opts.inventoryAvailable === 1 ? "unit" : "units";
      return `${staff} set inventory to ${opts.inventoryAvailable} ${unit}`;
    }
    return `${staff} updated inventory`;
  }

  if (topic.endsWith("/update")) {
    if (diff.length === 1) {
      const label = humanizeField(diff[0].field).toLowerCase();
      return `${staff} changed the ${label} on ${title}`;
    }
    if (diff.length > 1) {
      return `${staff} made ${diff.length} changes to ${title}`;
    }
    return `${staff} updated ${title}`;
  }

  // generic fallback (themes, shop, collections with no diff etc.)
  return `${staff} changed ${title}`;
}
