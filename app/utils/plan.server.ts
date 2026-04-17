import { PrismaClient } from "@prisma/client";

// Re-export the client-safe pieces so server code can import everything
// from one place if it wants to.
export {
  type Plan,
  PLANS,
  CATEGORY_PLAN,
  canRecordCategory,
} from "./plan";

const prisma = new PrismaClient();

export async function getShopSettings(shop: string) {
  const existing = await prisma.shopSettings.findUnique({ where: { shop } });
  if (existing) return existing;
  return await prisma.shopSettings.create({ data: { shop } });
}
