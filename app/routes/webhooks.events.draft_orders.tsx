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
  const summary = topic === "DRAFT_ORDERS_CREATE"
    ? `${staff.staffName || "A staff member"} created draft order ${num}`
    : `${staff.staffName || "A staff member"} updated draft order ${num}`;

  await recordEvent({
    shop,
    category: "draft_order",
    topic: topic.toLowerCase().replace(/_/g, "/"),
    resourceId: id,
    resourceTitle: `Draft ${num}`,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
