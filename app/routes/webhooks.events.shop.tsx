import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "shop")) return new Response();

  const staff = parseStaff(request.headers, payload);

  await recordEvent({
    shop,
    category: "shop",
    topic: topic.toLowerCase().replace(/_/g, "/"),
    resourceId: null,
    resourceTitle: "Shop settings",
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary: `${staff.staffName || "A staff member"} updated shop settings`,
    raw: payload,
  });

  return new Response();
};
