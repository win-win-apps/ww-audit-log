import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "customer")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  // We show the customer's name / email in the summary and resourceTitle so
  // the audit log is actually useful. That field stays out of rawJson because
  // recordEvent scrubs the payload before serializing.
  const name =
    [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
    p?.email ||
    `customer ${p?.id ?? ""}`.trim();
  const id = p?.id ? `gid://shopify/Customer/${p.id}` : null;
  const staffName = staff.staffName || "A staff member";
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  let summary = "";
  if (topic === "CUSTOMERS_CREATE") summary = `${staffName} added customer ${name}`;
  else if (topic === "CUSTOMERS_UPDATE") summary = `${staffName} updated customer ${name}`;
  else if (topic === "CUSTOMERS_DELETE") summary = `${staffName} deleted customer ${name}`;
  else if (topic === "CUSTOMERS_ENABLE") summary = `${staffName} enabled account for ${name}`;
  else if (topic === "CUSTOMERS_DISABLE") summary = `${staffName} disabled account for ${name}`;
  else summary = `${staffName} changed customer ${name}`;

  await recordEvent({
    shop,
    category: "customer",
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
