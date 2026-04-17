import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent, diffProducts, getPrevSnapshot, setPrevSnapshot } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";
import { friendlySummary } from "../utils/humanize";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "product")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const title = (payload as any)?.title;
  const id = (payload as any)?.id ? `gid://shopify/Product/${(payload as any).id}` : null;

  let summary = "";
  let diff: Array<{ field: string; before: any; after: any }> = [];

  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  if (topic === "PRODUCTS_CREATE") {
    setPrevSnapshot(shop, String((payload as any).id), payload);
  } else if (topic === "PRODUCTS_UPDATE") {
    const prev = getPrevSnapshot(shop, String((payload as any).id));
    if (prev) {
      diff = diffProducts(prev, payload);
    }
    setPrevSnapshot(shop, String((payload as any).id), payload);
  }

  summary = friendlySummary({
    topic: topicSlash,
    staffName: staff.staffName,
    resourceTitle: title || null,
    diff,
  });

  await recordEvent({
    shop,
    category: "product",
    topic: topicSlash,
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
