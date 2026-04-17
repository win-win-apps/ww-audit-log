import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "market")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const name = p?.name || `Market ${p?.id ?? ""}`.trim();
  const id = p?.id ? `gid://shopify/Market/${p.id}` : null;
  const staffName = staff.staffName || "A staff member";
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  let summary = "";
  if (topic === "MARKETS_CREATE") summary = `${staffName} created market ${name}`;
  else if (topic === "MARKETS_UPDATE") summary = `${staffName} updated market ${name}`;
  else if (topic === "MARKETS_DELETE") summary = `${staffName} deleted market ${name}`;
  else summary = `${staffName} changed market ${name}`;

  await recordEvent({
    shop,
    category: "market",
    topic: topicSlash,
    resourceId: id,
    resourceTitle: name,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
