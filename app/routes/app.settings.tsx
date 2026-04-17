import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Banner,
  Box,
} from "@shopify/polaris";
import { PrismaClient } from "@prisma/client";
import { authenticate, PRO_PLAN, PREMIUM_PLAN } from "../shopify.server";
import { getShopSettings } from "../utils/plan.server";
import { PLANS, type Plan } from "../utils/plan";

const prisma = new PrismaClient();

// Use test charges on dev stores so we never hit a real card during development.
// Shopify treats isTest=true as a free test charge on dev/test stores.
const IS_TEST = process.env.NODE_ENV !== "production";

// Map our internal plan keys to the Shopify billing plan names declared in shopify.server.ts.
const PLAN_NAME = {
  paid: PRO_PLAN,
  premium: PREMIUM_PLAN,
} as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);

  // Reconcile local plan state against whatever Shopify says the store is subscribed to.
  // We trust Shopify as the source of truth on active paid subscriptions.
  let resolvedPlan = settings.plan;
  try {
    const check = await billing.check({
      plans: [PRO_PLAN, PREMIUM_PLAN],
      isTest: IS_TEST,
    });
    if (check.hasActivePayment && check.appSubscriptions.length > 0) {
      const name = check.appSubscriptions[0].name;
      const mapped: Plan =
        name === PREMIUM_PLAN ? "premium" : name === PRO_PLAN ? "paid" : "free";
      if (mapped !== settings.plan) {
        await prisma.shopSettings.update({
          where: { shop: session.shop },
          data: {
            plan: mapped,
            retentionDays: PLANS[mapped].retention,
          },
        });
        resolvedPlan = mapped;
      }
    } else if (settings.plan !== "free") {
      // Shopify says no active subscription but our DB says paid. Drop to free.
      await prisma.shopSettings.update({
        where: { shop: session.shop },
        data: { plan: "free", retentionDays: PLANS.free.retention },
      });
      resolvedPlan = "free";
    }
  } catch (err) {
    // If billing.check fails (e.g. the app hasn't been deployed yet and Shopify
    // can't reach it, or the app isn't distributed as AppStore), just fall
    // through with the DB value. The settings page still renders.
    console.error("billing.check failed:", err);
  }

  const finalSettings =
    resolvedPlan === settings.plan
      ? settings
      : await getShopSettings(session.shop);

  return json({
    plan: finalSettings.plan,
    retentionDays: finalSettings.retentionDays,
    plans: PLANS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const target = String(formData.get("plan") || "");

  if (intent === "upgrade" && (target === "paid" || target === "premium")) {
    const planName = PLAN_NAME[target];
    // billing.request returns a redirect to the Shopify-hosted charge confirmation page.
    // The merchant approves there, Shopify redirects back to our app with a charge_id.
    return billing.request({
      plan: planName,
      isTest: IS_TEST,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app/settings?upgraded=${target}`,
    });
  }

  if (intent === "downgrade_free") {
    // Cancel any active paid subscription, then update local state.
    try {
      const check = await billing.check({
        plans: [PRO_PLAN, PREMIUM_PLAN],
        isTest: IS_TEST,
      });
      if (check.hasActivePayment) {
        for (const sub of check.appSubscriptions) {
          await billing.cancel({
            subscriptionId: sub.id,
            isTest: IS_TEST,
            prorate: true,
          });
        }
      }
    } catch (err) {
      console.error("billing.cancel failed (continuing with local downgrade):", err);
    }
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { plan: "free", retentionDays: PLANS.free.retention },
      create: { shop: session.shop, plan: "free", retentionDays: PLANS.free.retention },
    });
    return json({ ok: true, message: "Switched to Free plan. Events past 10 days will be purged on the next daily cleanup." });
  }

  return json({ ok: false, message: "Unknown action" });
};

export default function SettingsPage() {
  const { plan, retentionDays, plans } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page title="Settings" backAction={{ url: "/app" }}>
      <BlockStack gap="500">
        {actionData?.message && (
          <Banner tone={actionData.ok ? "success" : "critical"}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">Your plan</Text>
            <Text as="p" tone="subdued">
              You are on the <strong>{plans[plan as Plan].label}</strong> plan with {retentionDays}-day event history.
            </Text>
            <InlineStack gap="400" wrap>
              {(["free", "paid", "premium"] as Plan[]).map((p) => {
                const info = plans[p];
                const current = plan === p;
                return (
                  <Box
                    key={p}
                    padding="400"
                    background={current ? "bg-surface-selected" : "bg-surface"}
                    borderColor={current ? "border-focus" : "border"}
                    borderWidth="025"
                    borderRadius="200"
                    minWidth="240px"
                  >
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">{info.label}</Text>
                      <Text as="p" variant="headingLg">
                        ${info.price}
                        <Text as="span" variant="bodySm" tone="subdued"> / month</Text>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {p === "free" && "Products and inventory tracking. 10-day history. CSV export."}
                        {p === "paid" && "Adds collections tracking. 365-day history. Staff filter. Full-history CSV export."}
                        {p === "premium" && "Adds theme and shop setting changes. 10-year retention. Priority support."}
                      </Text>
                      {!current && (
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value={p === "free" ? "downgrade_free" : "upgrade"}
                          />
                          <input type="hidden" name="plan" value={p} />
                          <Button submit variant={p === "free" ? "secondary" : "primary"}>
                            {p === "free" ? "Downgrade to Free" : `Upgrade to ${info.label}`}
                          </Button>
                        </Form>
                      )}
                      {current && <Text as="p" tone="success" variant="bodySm">Current plan</Text>}
                    </BlockStack>
                  </Box>
                );
              })}
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Paid upgrades route through Shopify's charge approval page. You confirm the charge there, and Shopify redirects you back once approved.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingLg">Data retention</Text>
            <Text as="p" tone="subdued">
              Events older than {retentionDays} days are automatically deleted. Upgrade for longer retention.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingLg">Privacy</Text>
            <Text as="p" tone="subdued">
              This app only records admin actions on your store. No customer personal data is stored.
            </Text>
            <Box>
              <Button url="/privacy" target="_blank">View privacy policy</Button>
            </Box>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
