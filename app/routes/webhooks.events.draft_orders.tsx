import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "draft_order")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const id = p?.id ? `gid://shopify/DraftOrder/${p.id}` : null;
  const num = p?.name ?? p?.id;
  const staffName = staff.staffName || "A staff member";
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  let summary = "";
  if (topic === "DRAFT_ORDERS_CREATE") summary = `${staffName} created draft order ${num}`;
  else if (topic === "DRAFT_ORDERS_UPDATE") summary = `${staffName} updated draft order ${num}`;
  else if (topic === "DRAFT_ORDERS_DELETE") summary = `${staffName} deleted draft order ${num}`;
  else summary = `${staffName} changed draft order ${num}`;

  await recordEvent({
    shop,
    category: "draft_order",
    topic: topicSlash,
    resourceId: id,
    resourceTitle: `Draft ${num}`,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
