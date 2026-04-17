// Client-safe plan constants. No DB imports here so Remix can pull these
// into client bundles without triggering the "server-only module referenced
// by client" build error.
//
// Anything that touches Prisma lives in plan.server.ts.

export type Plan = "free" | "paid";

// Sentinel we use to mean "unlimited retention". Anything at or above this
// value is treated as infinite in the UI. We pick a real number (not
// Number.MAX_SAFE_INTEGER) so Prisma Int columns can store it cleanly.
export const UNLIMITED_RETENTION = 99999;

export const PLANS: Record<Plan, { label: string; price: number; retention: number }> = {
  free: { label: "Free", price: 0, retention: 3 },
  paid: { label: "Paid", price: 9.99, retention: UNLIMITED_RETENTION },
};

// Categories are NOT gated by plan anymore. Free and Paid both record
// everything we know how to record. The only difference is retention:
// Free keeps a 3 day rolling window, Paid keeps history forever.
//
// Kept as an empty record so callers that reference it don't have to
// change, and so re-introducing gating later is a one line change.
export const CATEGORY_PLAN: Record<string, Plan> = {};

export function canRecordCategory(_plan: Plan, _category: string): boolean {
  // Every plan records every category. Retention is enforced at read + GC time,
  // not at write time, so even Free users get complete audit coverage for the
  // trailing 3 days.
  return true;
}

// Normalise whatever the DB hands back into one of our supported plans.
// Existing rows may still carry "premium" from the old 3 tier pricing, so
// we collapse them into "paid" on read.
export function normalisePlan(raw: string | null | undefined): Plan {
  if (raw === "paid" || raw === "premium") return "paid";
  return "free";
}

export function isUnlimited(retentionDays: number): boolean {
  return retentionDays >= UNLIMITED_RETENTION;
}
