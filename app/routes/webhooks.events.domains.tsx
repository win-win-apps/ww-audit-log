import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "domain")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const host = p?.host || p?.domain || `Domain ${p?.id ?? ""}`.trim();
  const id = p?.id ? `gid://shopify/Domain/${p.id}` : null;
  const staffName = staff.staffName || "A staff member";
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  let summary = "";
  if (topic === "DOMAINS_CREATE") summary = `${staffName} added domain ${host}`;
  else if (topic === "DOMAINS_UPDATE") summary = `${staffName} updated domain ${host}`;
  else if (topic === "DOMAINS_DESTROY") summary = `${staffName} removed domain ${host}`;
  else summary = `${staffName} changed domain ${host}`;

  await recordEvent({
    shop,
    category: "domain",
    topic: topicSlash,
    resourceId: id,
    resourceTitle: host,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
