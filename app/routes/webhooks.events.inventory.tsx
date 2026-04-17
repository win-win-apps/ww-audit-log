import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";
import { friendlySummary } from "../utils/humanize";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "inventory")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const available = typeof p?.available === "number" ? p.available : null;
  const inventoryItemId = p?.inventory_item_id;
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");
  const resourceTitle = `Inventory item ${inventoryItemId}`;

  // We emit one diff entry so the detail panel can show the new count in the
  // Before/After columns (Before stays empty because Shopify's webhook doesn't
  // tell us the previous value for inventory_levels).
  const diff =
    available !== null
      ? [{ field: "inventory", before: null, after: available }]
      : [];

  const summary = friendlySummary({
    topic: topicSlash,
    staffName: staff.staffName,
    resourceTitle,
    diff,
    inventoryAvailable: available,
  });

  await recordEvent({
    shop,
    category: "inventory",
    topic: topicSlash,
    resourceId: inventoryItemId ? `gid://shopify/InventoryItem/${inventoryItemId}` : null,
    resourceTitle,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    diff,
    raw: payload,
  });

  return new Response();
};
