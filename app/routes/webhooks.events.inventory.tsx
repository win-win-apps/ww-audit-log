import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "inventory")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  const available = p?.available;
  const inventoryItemId = p?.inventory_item_id;
  const locationId = p?.location_id;

  const summary = `${staff.staffName || "A staff member"} set inventory to ${available} at location ${locationId}`;

  await recordEvent({
    shop,
    category: "inventory",
    topic: topic.toLowerCase().replace(/_/g, "/"),
    resourceId: inventoryItemId ? `gid://shopify/InventoryItem/${inventoryItemId}` : null,
    resourceTitle: `Inventory item ${inventoryItemId}`,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
