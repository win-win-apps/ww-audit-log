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

  // Export matches whatever the merchant can actually see. Two modes:
  //   preset: ?days=30
  //   custom: ?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Custom wins when both dates parse. Retention still clamps the since date.
  const rawFrom = url.searchParams.get("from") || "";
  const rawTo = url.searchParams.get("to") || "";
  const parsedFrom = rawFrom ? new Date(rawFrom) : null;
  const parsedTo = rawTo ? new Date(rawTo) : null;
  const usingCustom =
    parsedFrom !== null && !isNaN(parsedFrom.getTime()) &&
    parsedTo !== null && !isNaN(parsedTo.getTime());

  const requestedDays = Number(url.searchParams.get("days") || settings.retentionDays);
  const exportDays = Math.min(requestedDays, settings.retentionDays);
  const category = url.searchParams.get("category") || "";
  const staff = url.searchParams.get("staff") || "";
  const q = url.searchParams.get("q") || "";

  let since: Date;
  let until: Date;
  if (usingCustom) {
    since = new Date(parsedFrom!);
    since.setHours(0, 0, 0, 0);
    until = new Date(parsedTo!);
    until.setHours(23, 59, 59, 999);
    // Retention clamp
    const UNLIMITED = 99999;
    if (settings.retentionDays < UNLIMITED) {
      const earliest = new Date();
      earliest.setDate(earliest.getDate() - settings.retentionDays);
      earliest.setHours(0, 0, 0, 0);
      if (since < earliest) since = earliest;
    }
  } else {
    since = new Date();
    since.setDate(since.getDate() - exportDays);
    until = new Date();
  }

  const where: any = { shop, createdAt: { gte: since, lte: until } };
  if (category) where.category = category;
  if (staff) where.staffName = { contains: staff, mode: "insensitive" };
  if (q) {
    where.OR = [
      { summary: { contains: q, mode: "insensitive" } },
      { resourceTitle: { contains: q, mode: "insensitive" } },
    ];
  }

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
