import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export type Plan = "free" | "paid" | "premium";

export const PLANS: Record<Plan, { label: string; price: number; retention: number }> = {
  free: { label: "Free", price: 0, retention: 10 },
  paid: { label: "Pro", price: 3.99, retention: 365 },
  premium: { label: "Unlimited", price: 7.99, retention: 3650 },
};

// Which webhook categories are included in which plan.
// Free tier covers the core admin actions merchants worry about (products, inventory, orders).
// Paid adds collections, customers, draft_orders.
// Premium adds themes, shop, fulfillments.
export const CATEGORY_PLAN: Record<string, Plan> = {
  product: "free",
  inventory: "free",
  order: "free",
  collection: "paid",
  customer: "paid",
  draft_order: "paid",
  theme: "premium",
  shop: "premium",
  fulfillment: "premium",
  app: "free",
};

export async function getShopSettings(shop: string) {
  const existing = await prisma.shopSettings.findUnique({ where: { shop } });
  if (existing) return existing;
  return await prisma.shopSettings.create({ data: { shop } });
}

export function canRecordCategory(plan: Plan, category: string): boolean {
  const required = CATEGORY_PLAN[category];
  if (!required) return true;
  if (required === "free") return true;
  if (required === "paid") return plan === "paid" || plan === "premium";
  if (required === "premium") return plan === "premium";
  return false;
}
