import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, prisma } from "../shopify.server";

/**
 * GDPR compliance webhooks for the Audit Log app.
 *
 * This app stores no customer personal data. It stores audit events
 * that record staff actions on the store (products, orders, inventory etc.)
 * and shop-level settings. Customer topics are acknowledged with no action.
 *
 * Topics handled here:
 *   - customers/data_request   Customer requests a copy of their data.
 *   - customers/redact         Shopify requests customer data erasure.
 *   - shop/redact              Shop uninstalled the app 48 hours ago and
 *                              all shop-level data must be erased.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[compliance] ${topic} for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // No customer personal data stored.
      break;

    case "SHOP_REDACT":
      await prisma.auditEvent.deleteMany({ where: { shop } }).catch((e: unknown) => {
        console.error("shop/redact auditEvent deleteMany failed:", e);
      });
      await prisma.shopSettings.deleteMany({ where: { shop } }).catch((e: unknown) => {
        console.error("shop/redact shopSettings deleteMany failed:", e);
      });
      await prisma.session.deleteMany({ where: { shop } }).catch((e: unknown) => {
        console.error("shop/redact session deleteMany failed:", e);
      });
      break;

    default:
      console.warn(`[compliance] unknown topic received: ${topic}`);
      break;
  }

  return new Response();
};
