import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

// price_rules is the admin-created discount surface. The payload has a
// `title` (internal name), `value_type` (percentage / fixed_amount), and
// `value` (how much). We build a human-readable summary from those.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "discount")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const title = p?.title || `Discount ${p?.id ?? ""}`.trim();
  const id = p?.id ? `gid://shopify/PriceRule/${p.id}` : null;
  const staffName = staff.staffName || "A staff member";
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  let summary = "";
  if (topic === "PRICE_RULES_CREATE") summary = `${staffName} created discount ${title}`;
  else if (topic === "PRICE_RULES_UPDATE") summary = `${staffName} updated discount ${title}`;
  else if (topic === "PRICE_RULES_DELETE") summary = `${staffName} deleted discount ${title}`;
  else summary = `${staffName} changed discount ${title}`;

  await recordEvent({
    shop,
    category: "discount",
    topic: topicSlash,
    resourceId: id,
    resourceTitle: title,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
