import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent, money } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "order")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const orderNumber = p?.order_number ?? p?.name ?? p?.id;
  const id = p?.id ? `gid://shopify/Order/${p.id}` : null;
  const currency = p?.currency || "USD";
  const staffName = staff.staffName || "A staff member";
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  let summary = "";
  if (topic === "ORDERS_CREATE") {
    summary = `New order #${orderNumber} placed for ${money(p?.total_price, currency)}`;
  } else if (topic === "ORDERS_UPDATED") {
    summary = `${staffName} updated order #${orderNumber}`;
  } else if (topic === "ORDERS_CANCELLED") {
    summary = `${staffName} cancelled order #${orderNumber}`;
  } else if (topic === "ORDERS_FULFILLED") {
    summary = `Order #${orderNumber} was marked fulfilled`;
  } else if (topic === "ORDERS_PAID") {
    summary = `Order #${orderNumber} was marked paid`;
  } else if (topic === "ORDERS_PARTIALLY_FULFILLED") {
    summary = `Order #${orderNumber} was partially fulfilled`;
  } else if (topic === "ORDERS_EDITED") {
    summary = `${staffName} edited line items on order #${orderNumber}`;
  } else if (topic === "ORDERS_DELETE") {
    summary = `${staffName} deleted order #${orderNumber}`;
  } else {
    summary = `${staffName} changed order #${orderNumber}`;
  }

  await recordEvent({
    shop,
    category: "order",
    topic: topicSlash,
    resourceId: id,
    resourceTitle: `Order #${orderNumber}`,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
