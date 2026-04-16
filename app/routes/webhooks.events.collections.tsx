import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "collection")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const title = p?.title || "collection";
  const id = p?.id ? `gid://shopify/Collection/${p.id}` : null;

  let summary = "";
  if (topic === "COLLECTIONS_CREATE") summary = `${staff.staffName || "A staff member"} created collection ${title}`;
  else if (topic === "COLLECTIONS_UPDATE") summary = `${staff.staffName || "A staff member"} updated collection ${title}`;
  else if (topic === "COLLECTIONS_DELETE") summary = `${staff.staffName || "A staff member"} deleted collection ${title}`;

  await recordEvent({
    shop,
    category: "collection",
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
