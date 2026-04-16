import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "theme")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const title = p?.name || "theme";
  const id = p?.id ? `gid://shopify/OnlineStoreTheme/${p.id}` : null;

  let summary = "";
  if (topic === "THEMES_CREATE") summary = `${staff.staffName || "A staff member"} installed theme ${title}`;
  else if (topic === "THEMES_UPDATE") summary = `${staff.staffName || "A staff member"} updated theme ${title}`;
  else if (topic === "THEMES_PUBLISH") summary = `${staff.staffName || "A staff member"} published theme ${title}`;
  else if (topic === "THEMES_DELETE") summary = `${staff.staffName || "A staff member"} deleted theme ${title}`;

  await recordEvent({
    shop,
    category: "theme",
    topic: topic.toLowerCase().replace(/_/g, "/"),
    resourceId: id,
    resourceTitle: title,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
