import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent, diffProducts, getPrevSnapshot, setPrevSnapshot } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "product")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const title = (payload as any)?.title;
  const id = (payload as any)?.id ? `gid://shopify/Product/${(payload as any).id}` : null;

  let summary = "";
  let diff: Array<{ field: string; before: any; after: any }> = [];

  if (topic === "PRODUCTS_CREATE") {
    summary = `${staff.staffName || "A staff member"} added a product: ${title || "untitled"}`;
    setPrevSnapshot(shop, String((payload as any).id), payload);
  } else if (topic === "PRODUCTS_UPDATE") {
    const prev = getPrevSnapshot(shop, String((payload as any).id));
    if (prev) {
      diff = diffProducts(prev, payload);
    }
    if (diff.length === 0) {
      summary = `${staff.staffName || "A staff member"} updated ${title || "a product"}`;
    } else {
      const bits = diff.slice(0, 3).map((d) => `${d.field} → ${d.after}`).join(", ");
      summary = `${staff.staffName || "A staff member"} changed ${bits}${diff.length > 3 ? ` and ${diff.length - 3} more` : ""} on ${title}`;
    }
    setPrevSnapshot(shop, String((payload as any).id), payload);
  } else if (topic === "PRODUCTS_DELETE") {
    summary = `${staff.staffName || "A staff member"} deleted product ${title || "(untitled)"}`;
  }

  await recordEvent({
    shop,
    category: "product",
    topic: topic.toLowerCase().replace(/_/g, "/"),
    resourceId: id,
    resourceTitle: title || null,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    diff,
    raw: payload,
  });

  return new Response();
};
