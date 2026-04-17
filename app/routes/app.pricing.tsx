import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Legacy route. Pricing and upgrades now live on /app/billing via the
// built-in shopify-app-remix billing helper (billing.request / billing.check
// / billing.cancel), so we just bounce any old links over.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app/billing");
};

export default function Pricing() {
  return null;
}
