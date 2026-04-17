import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { parseStaff, recordEvent } from "../utils/audit.server";
import { getShopSettings, canRecordCategory, type Plan } from "../utils/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const settings = await getShopSettings(shop);
  if (!canRecordCategory(settings.plan as Plan, "file")) return new Response();

  const staff = parseStaff(request.headers, payload);
  const p = payload as any;
  // Files are identified by filename or the CDN URL. Try filename first.
  const filename =
    p?.filename ||
    p?.alt ||
    (typeof p?.url === "string" ? p.url.split("/").pop() : null) ||
    `File ${p?.id ?? ""}`.trim();
  const id = p?.id ? `gid://shopify/File/${p.id}` : null;
  const staffName = staff.staffName || "A staff member";
  const topicSlash = topic.toLowerCase().replace(/_/g, "/");

  let summary = "";
  if (topic === "FILES_CREATE") summary = `${staffName} uploaded ${filename}`;
  else if (topic === "FILES_UPDATE") summary = `${staffName} updated ${filename}`;
  else if (topic === "FILES_DELETE") summary = `${staffName} deleted ${filename}`;
  else summary = `${staffName} changed ${filename}`;

  await recordEvent({
    shop,
    category: "file",
    topic: topicSlash,
    resourceId: id,
    resourceTitle: filename,
    staffId: staff.staffId,
    staffName: staff.staffName,
    summary,
    raw: payload,
  });

  return new Response();
};
