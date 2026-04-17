import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Webhooks send a header `X-Shopify-Triggered-By` containing a staff name/id when triggered by a human.
// Also may have `staff_id` in payload for some topics.
export function parseStaff(headers: Headers, payload: any): { staffId: string | null; staffName: string | null } {
  const triggered = headers.get("X-Shopify-Triggered-By");
  if (triggered) {
    // format: "staff:{id}:{name}" or just a user-agent style string
    const m = triggered.match(/staff:(\d+):(.+)/);
    if (m) return { staffId: m[1], staffName: m[2] };
    return { staffId: null, staffName: triggered };
  }
  if (payload?.user_id) {
    return { staffId: String(payload.user_id), staffName: payload.user_name || null };
  }
  if (payload?.staff_id) {
    return { staffId: String(payload.staff_id), staffName: null };
  }
  return { staffId: null, staffName: null };
}

// Keys that commonly hold customer PII across Shopify webhook payloads.
// We strip these before storing rawJson. v1.0 doesn't subscribe to
// customer-bearing topics at all, but scrubbing here is defense in depth
// so that a future webhook addition can't accidentally leak PII into our DB.
const PII_KEYS = new Set([
  "email",
  "phone",
  "first_name",
  "last_name",
  "name",
  "customer_email",
  "customer_phone",
  "contact_email",
  "address1",
  "address2",
  "street",
  "zip",
  "postal_code",
  "billing_address",
  "shipping_address",
  "default_address",
  "addresses",
  "note_attributes",
  "client_details",
  "ip",
  "user_agent",
  "accepts_marketing",
  "marketing_opt_in_level",
  "sms_marketing_consent",
  "email_marketing_consent",
]);

function scrubPII(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrubPII);
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (PII_KEYS.has(k)) out[k] = "[redacted]";
      else out[k] = scrubPII(v);
    }
    return out;
  }
  return value;
}

// Trim a raw payload to <= 8k bytes to cap storage cost.
// Also scrubs well-known PII keys before serializing.
export function trimRaw(raw: any): string {
  const scrubbed = scrubPII(raw ?? {});
  const s = JSON.stringify(scrubbed);
  if (s.length <= 8000) return s;
  return s.slice(0, 7980) + "…[trimmed]";
}

export function money(amount: any, currency = "USD"): string {
  const n = Number(amount);
  if (!isFinite(n)) return String(amount ?? "");
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}

interface RecordOpts {
  shop: string;
  category: string;
  topic: string;
  resourceId?: string | null;
  resourceTitle?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  summary: string;
  diff?: Array<{ field: string; before: any; after: any }>;
  raw?: any;
}

export async function recordEvent(opts: RecordOpts) {
  try {
    await prisma.auditEvent.create({
      data: {
        shop: opts.shop,
        category: opts.category,
        topic: opts.topic,
        resourceId: opts.resourceId ?? null,
        resourceTitle: opts.resourceTitle ?? null,
        staffId: opts.staffId ?? null,
        staffName: opts.staffName ?? null,
        summary: opts.summary,
        diffJson: JSON.stringify(opts.diff ?? []),
        rawJson: trimRaw(opts.raw),
      },
    });
  } catch (err) {
    // Never throw from a webhook handler. Log and swallow.
    console.error("recordEvent failed:", err);
  }
}

// Compare two product payloads and produce a list of changed fields.
// We track: title, status, vendor, product_type, and per-variant price/compare_at/inventory_quantity.
export function diffProducts(before: any, after: any): Array<{ field: string; before: any; after: any }> {
  const diff: Array<{ field: string; before: any; after: any }> = [];
  if (!before || !after) return diff;
  const fields = ["title", "status", "vendor", "product_type", "handle"];
  for (const f of fields) {
    if (before[f] !== after[f]) diff.push({ field: f, before: before[f], after: after[f] });
  }
  // Variants: compare by variant id
  const bMap = new Map<any, any>((before.variants || []).map((v: any) => [v.id, v]));
  const aMap = new Map<any, any>((after.variants || []).map((v: any) => [v.id, v]));
  for (const [id, av] of aMap) {
    const bv = bMap.get(id);
    if (!bv) continue;
    if (bv.price !== av.price) diff.push({ field: `variant.${av.title || id}.price`, before: bv.price, after: av.price });
    if (bv.compare_at_price !== av.compare_at_price) diff.push({ field: `variant.${av.title || id}.compare_at_price`, before: bv.compare_at_price, after: av.compare_at_price });
    if (bv.inventory_quantity !== av.inventory_quantity) diff.push({ field: `variant.${av.title || id}.inventory`, before: bv.inventory_quantity, after: av.inventory_quantity });
  }
  return diff;
}

// Simple in-memory cache of "last seen" product snapshots per shop+id.
// Survives for the lifetime of a single server instance. For real cross-restart diff we'd need
// a dedicated ProductSnapshot model; for v1 this is good enough and keeps the DB small.
const productSnapshotCache = new Map<string, any>();
export function getPrevSnapshot(shop: string, id: string): any | undefined {
  return productSnapshotCache.get(`${shop}:${id}`);
}
export function setPrevSnapshot(shop: string, id: string, snap: any) {
  productSnapshotCache.set(`${shop}:${id}`, snap);
}
