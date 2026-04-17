import type { LoaderFunctionArgs } from "@remix-run/node";
import Papa from "papaparse";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { getShopSettings } from "../utils/plan.server";

const prisma = new PrismaClient();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getShopSettings(shop);
  const url = new URL(request.url);

  // Export matches whatever the merchant can actually see. Free gets the
  // last N days where N is their retention. Paid gets the requested window
  // (defaulting to retention, which is effectively unlimited).
  const requestedDays = Number(url.searchParams.get("days") || settings.retentionDays);
  const exportDays = Math.min(requestedDays, settings.retentionDays);
  const category = url.searchParams.get("category") || "";
  const since = new Date();
  since.setDate(since.getDate() - exportDays);

  const where: any = { shop, createdAt: { gte: since } };
  if (category) where.category = category;

  const events = await prisma.auditEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50000,
  });

  const csv = Papa.unparse(
    events.map((e) => ({
      when: e.createdAt.toISOString(),
      category: e.category,
      topic: e.topic,
      who: e.staffName || "",
      what: e.summary,
      resource: e.resourceTitle || "",
      resource_id: e.resourceId || "",
    })),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
};
