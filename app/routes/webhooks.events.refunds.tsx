import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent, money } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

// refunds/create is the only topic — refunds cant be edited once issued.
// The payload has order_id, transactions[] with amount + currency, and note.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "refund")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const orderId = p?.order_id;
  const id = p?.id ? `gid://shopify/Refund/${p.id}` : null;
  const staffName = staff.staffName || "A staff member";
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  // Sum transaction amounts to get the refund total. Transactions carry
  // their own currency — fall back to the first.
  const txs = Array.isArray(p?.transactions) ? p.transactions : [];
  const currency = txs[0]?.currency || p?.currency || "USD";
  const total = txs.reduce((acc: number, t: any) => acc + Number(t?.amount || 0), 0);
  const totalLabel = money(total, currency);

  const summary = `${staffName} refunded ${totalLabel} on order ${orderId ?? ""}`.trim();

  await recordEvent({
    shop,
    category: "refund",
    topic: topicSlash,
    resourceId: id,
    resourceTitle: `Refund on order ${orderId ?? ""}`.trim(),
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
