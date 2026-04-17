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
// Coverage tier by plan:
//   Free    -> catalogue basics: products, inventory
//   Pro     -> adds ops data: collections, orders, draft orders,
//              fulfillments, refunds, discounts, locations, files
//   Premium -> adds security-sensitive surfaces: themes, shop settings,
//              customers, markets, domains
export const CATEGORY_PLAN: Record<string, Plan> = {
  product: "free",
  inventory: "free",
  app: "free",

  collection: "paid",
  order: "paid",
  draft_order: "paid",
  fulfillment: "paid",
  refund: "paid",
  discount: "paid",
  location: "paid",
  file: "paid",

  theme: "premium",
  shop: "premium",
  customer: "premium",
  market: "premium",
  domain: "premium",
};

export function canRecordCategory(plan: Plan, category: string): boolean {
  const required = CATEGORY_PLAN[category];
  if (!required) return true;
  if (required === "free") return true;
  if (required === "paid") return plan === "paid" || plan === "premium";
  if (required === "premium") return plan === "premium";
  return false;
}
