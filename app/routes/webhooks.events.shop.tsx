import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  parseStaff,
  recordEvent,
  diffShop,
  getPrevShopSnapshot,
  setPrevShopSnapshot,
} from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";
import { friendlySummary } from "../utils/humanize";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "shop")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  // Shopify fires shop/update on lots of internal state that merchants never
  // see (plan counters, various flags). We only want to record events when
  // something in our whitelist actually changed. Snapshot the first payload
  // so we have a baseline for the next comparison.
  const prev = getPrevShopSnapshot(shop);
  setPrevShopSnapshot(shop, payload);

  if (!prev) {
    // First webhook after the server started. Nothing to compare against, so
    // we bank the snapshot and return without logging anything.
    return new Response();
  }

  const diff = diffShop(prev, payload);
  if (diff.length === 0) {
    // Payload changed somewhere Shopify tracks but not in any field a merchant
    // would recognize as a setting. Skip to avoid noise.
    return new Response();
  }

  const summary = friendlySummary({
    topic: topicSlash,
    staffName: staff.staffName,
    resourceTitle: "Shop settings",
    diff,
  });

  await recordEvent({
    shop,
    category: "shop",
    topic: topicSlash,
    resourceId: null,
    resourceTitle: "Shop settings",
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    diff,
    raw: payload,
    // Shop payload contains the merchant's own contact info. That's the data
    // we're auditing, not customer PII, so skip the scrubber.
    skipRawScrub: true,
  });

  return new Response();
};
