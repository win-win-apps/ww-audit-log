import { PrismaClient } from "@prisma/client";
import { PLANS, normalisePlan } from "./plan";

// Re-export the client-safe pieces so server code can import everything
// from one place if it wants to.
export {
  type Plan,
  PLANS,
  CATEGORY_PLAN,
  canRecordCategory,
  UNLIMITED_RETENTION,
  isUnlimited,
  normalisePlan,
} from "./plan";

const prisma = new PrismaClient();

export async function getShopSettings(shop: string) {
  const existing = await prisma.shopSettings.findUnique({ where: { shop } });
  if (existing) {
    // Legacy rows may carry plan="premium" from the old 3 tier pricing. We
    // don't write through here (keeping this read-only + cheap), so callers
    // that care about plan should use normalisePlan() on settings.plan.
    // Also: if a legacy Free row has retentionDays>PLANS.free.retention (was 10),
    // leave it for the cleanup cron to enforce; the UI clamp handles display.
    return existing;
  }
  // Fresh install. Create with the current Free plan defaults so we don't
  // rely on the Prisma schema default (which lagged behind the pricing change).
  return await prisma.shopSettings.create({
    data: {
      shop,
      plan: "free",
      retentionDays: PLANS.free.retention,
    },
  });
}

// One shot reconciler for legacy Free rows that were created on the 10 day
// retention default. Called opportunistically so Free shops converge on the
// new 3 day window without us having to ship a DB migration. No op for Paid.
export async function reconcileFreeRetention(shop: string) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) return null;
  const plan = normalisePlan(settings.plan);
  if (plan !== "free") return settings;
  if (settings.retentionDays === PLANS.free.retention) return settings;
  return await prisma.shopSettings.update({
    where: { shop },
    data: { retentionDays: PLANS.free.retention },
  });
}
