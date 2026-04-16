import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "fulfillment")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const orderId = p?.order_id;
  const status = p?.status;
  const id = p?.id ? `gid://shopify/Fulfillment/${p.id}` : null;

  const summary = `Fulfillment ${status || "updated"} for order ${orderId}`;

  await recordEvent({
    shop,
    category: "fulfillment",
    topic: topic.toLowerCase().replace(/_/g, "/"),
    resourceId: id,
    resourceTitle: `Fulfillment ${p?.id || ""}`.trim(),
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
