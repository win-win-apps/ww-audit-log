import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Redirects to the Shopify-hosted managed pricing plan selection page.
// Managed pricing URL format:
//   https://admin.shopify.com/store/{storeHandle}/charges/{appHandle}/pricing_plans
// We must break out of the embedded app iframe using target: "_top", since the
// pricing page lives in the parent Shopify admin window.
const APP_HANDLE = "audit-log-staff-activity";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const storeHandle = session.shop.replace(".myshopify.com", "");
  const url = `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
  return redirect(url, { target: "_top" });
};

export default function Pricing() {
  return null;
}
