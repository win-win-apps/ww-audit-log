// Client-safe plan constants. No DB imports here so Remix can pull these
// into client bundles without triggering the "server-only module referenced
// by client" build error.
//
// Anything that touches Prisma lives in plan.server.ts.

export type Plan = "free" | "paid" | "premium";

export const PLANS: Record<Plan, { label: string; price: number; retention: number }> = {
  free: { label: "Free", price: 0, retention: 10 },
  paid: { label: "Pro", price: 3.99, retention: 365 },
  premium: { label: "Premium", price: 7.99, retention: 3650 },
};

// Which webhook categories are included in which plan.
// v1.0 scope (what we actually subscribe to in shopify.app.toml):
//   Free    -> products, inventory
//   Pro     -> adds collections
//   Premium -> adds themes, shop
// Deferred to v1.1 (requires Shopify protected customer data approval):
//   order, customer, draft_order, fulfillment
// We intentionally leave the deferred entries here so that adding the webhook
// subscriptions later will immediately flow through plan gating without forgetting.
export const CATEGORY_PLAN: Record<string, Plan> = {
  product: "free",
  inventory: "free",
  collection: "paid",
  theme: "premium",
  shop: "premium",
  app: "free",
  // Deferred to v1.1:
  order: "free",
  customer: "paid",
  draft_order: "paid",
  fulfillment: "paid",
};

export function canRecordCategory(plan: Plan, category: string): boolean {
  const required = CATEGORY_PLAN[category];
  if (!required) return true;
  if (required === "free") return true;
  if (required === "paid") return plan === "paid" || plan === "premium";
  if (required === "premium") return plan === "premium";
  return false;
}
