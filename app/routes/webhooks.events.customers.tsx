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
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.email || "a customer";
  const id = p?.id ? `gid://shopify/Customer/${p.id}` : null;

  let summary = "";
  if (topic === "CUSTOMERS_CREATE") summary = `New customer added: ${name}`;
  else if (topic === "CUSTOMERS_UPDATE") summary = `${staff.staffName || "A staff member"} updated customer ${name}`;
  else if (topic === "CUSTOMERS_DELETE") summary = `${staff.staffName || "A staff member"} deleted customer ${name}`;

  await recordEvent({
    shop,
    category: "customer",
    topic: topic.toLowerCase().replace(/_/g, "/"),
    resourceId: id,
    resourceTitle: name,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
