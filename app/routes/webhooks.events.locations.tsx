import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "location")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const name = p?.name || `Location ${p?.id ?? ""}`.trim();
  const id = p?.id ? `gid://shopify/Location/${p.id}` : null;
  const staffName = staff.staffName || "A staff member";
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  let summary = "";
  if (topic === "LOCATIONS_CREATE") summary = `${staffName} added location ${name}`;
  else if (topic === "LOCATIONS_UPDATE") summary = `${staffName} updated location ${name}`;
  else if (topic === "LOCATIONS_DELETE") summary = `${staffName} removed location ${name}`;
  else if (topic === "LOCATIONS_ACTIVATE") summary = `${staffName} activated location ${name}`;
  else if (topic === "LOCATIONS_DEACTIVATE") summary = `${staffName} deactivated location ${name}`;
  else summary = `${staffName} changed location ${name}`;

  await recordEvent({
    shop,
    category: "location",
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
