import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { UNLIMITED_RETENTION } from "../utils/plan";

const prisma = new PrismaClient();

// Retention enforcement. A fly.io scheduled machine (or supercronic) hits this
// endpoint once per day with `Authorization: Bearer $CRON_SECRET`, and we
// delete events that have aged past each shop's retentionDays. Shops on Paid
// use UNLIMITED_RETENTION as the sentinel, so we skip them.
//
// Also safe to call by hand for a one off cleanup. The response includes a
// per-shop breakdown so we can see what got pruned.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") || "";
    if (header !== `Bearer ${secret}`) {
      return new Response("unauthorized", { status: 401 });
    }
  }

  const shops = await prisma.shopSettings.findMany({
    select: { shop: true, retentionDays: true, plan: true },
  });

  const results: Array<{ shop: string; plan: string; deleted: number; retentionDays: number }> = [];

  for (const s of shops) {
    // Paid plan (unlimited sentinel) is a no op.
    if (s.retentionDays >= UNLIMITED_RETENTION) {
      results.push({ shop: s.shop, plan: s.plan, deleted: 0, retentionDays: s.retentionDays });
      continue;
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - s.retentionDays);
    const { count } = await prisma.auditEvent.deleteMany({
      where: { shop: s.shop, createdAt: { lt: cutoff } },
    });
    results.push({ shop: s.shop, plan: s.plan, deleted: count, retentionDays: s.retentionDays });
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);

  return json({ ok: true, totalDeleted, shops: results });
};
