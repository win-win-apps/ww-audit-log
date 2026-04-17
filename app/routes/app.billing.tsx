import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Banner,
  Box,
  Badge,
  List,
} from "@shopify/polaris";
import { PrismaClient } from "@prisma/client";
import { authenticate, PRO_PLAN, PREMIUM_PLAN } from "../shopify.server";
import { getShopSettings } from "../utils/plan.server";
import { PLANS, type Plan } from "../utils/plan";

const prisma = new PrismaClient();

// Use test charges on dev stores so we never hit a real card during development.
const IS_TEST = process.env.NODE_ENV !== "production";

const PLAN_NAME = {
  paid: PRO_PLAN,
  premium: PREMIUM_PLAN,
} as const;

// Build a returnUrl that works whether SHOPIFY_APP_URL is set or not. In local
// dev the Shopify CLI rotates the tunnel URL every restart, so we prefer the
// incoming request origin if the env var is missing.
function buildReturnUrl(request: Request, target: string): string {
  const envBase = process.env.SHOPIFY_APP_URL;
  const base = envBase || new URL(request.url).origin;
  return `${base}/app/billing?upgraded=${encodeURIComponent(target)}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);

  // Reconcile local plan state against whatever Shopify says the store is
  // subscribed to. Shopify is the source of truth for active paid subs.
  let resolvedPlan = settings.plan;
  let billingCheckFailed = false;
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
      // Shopify says no active sub but our DB says paid. Drop to free.
      await prisma.shopSettings.update({
        where: { shop: session.shop },
        data: { plan: "free", retentionDays: PLANS.free.retention },
      });
      resolvedPlan = "free";
    }
  } catch (err) {
    // billing.check can fail in local dev before app is deployed, or if the
    // API config is out of sync. Fall through with DB value and surface a
    // banner so the merchant isn't staring at a broken page.
    console.error("billing.check failed:", err);
    billingCheckFailed = true;
  }

  const finalSettings =
    resolvedPlan === settings.plan
      ? settings
      : await getShopSettings(session.shop);

  const url = new URL(request.url);
  const justUpgraded = url.searchParams.get("upgraded");

  return json({
    plan: finalSettings.plan,
    retentionDays: finalSettings.retentionDays,
    plans: PLANS,
    billingCheckFailed,
    justUpgraded,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const target = String(formData.get("plan") || "");

  if (intent === "upgrade" && (target === "paid" || target === "premium")) {
    const planName = PLAN_NAME[target];
    try {
      // billing.request throws a redirect Response that shopify-app-remix has
      // already wrapped so App Bridge can break out of the embedded iframe to
      // Shopify's charge approval page.
      return await billing.request({
        plan: planName,
        isTest: IS_TEST,
        returnUrl: buildReturnUrl(request, target),
      });
    } catch (err: any) {
      // The thrown redirect Response is the happy path. Only real errors land
      // here (API failure, plan name mismatch, etc).
      if (err instanceof Response) throw err;
      console.error("billing.request failed:", err);
      return json({
        ok: false,
        message:
          "Could not start the upgrade. This usually means the app hasn't been deployed yet (Shane handles the fly.io push). Try again once the app is live on production.",
      });
    }
  }

  if (intent === "downgrade_free") {
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
      create: {
        shop: session.shop,
        plan: "free",
        retentionDays: PLANS.free.retention,
      },
    });
    return json({
      ok: true,
      message:
        "Switched to Free plan. Events older than 10 days will be cleared on the next daily cleanup.",
    });
  }

  return json({ ok: false, message: "Unknown action" });
};

const PLAN_FEATURES: Record<Plan, string[]> = {
  free: [
    "Product and inventory changes",
    "10-day history",
    "CSV export (last 7 days)",
  ],
  paid: [
    "Everything in Free",
    "Orders, draft orders, fulfillments, refunds",
    "Discounts, locations, files, collections",
    "1 year of history",
    "Filter by staff",
    "Full-history CSV export",
  ],
  premium: [
    "Everything in Pro",
    "Customer changes",
    "Theme edits and shop settings",
    "Markets and domains",
    "10 years of history",
    "Priority support",
  ],
};

export default function BillingPage() {
  const { plan, retentionDays, plans, billingCheckFailed, justUpgraded } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  return (
    <Page title="Billing" backAction={{ url: "/app" }}>
      <BlockStack gap="500">
        {justUpgraded && (
          <Banner tone="success">
            <p>
              Upgrade approved. You are now on the{" "}
              <strong>{plans[plan as Plan].label}</strong> plan with{" "}
              {retentionDays}-day retention.
            </p>
          </Banner>
        )}

        {billingCheckFailed && (
          <Banner tone="warning" title="Billing status could not be verified">
            <p>
              Shopify did not respond to our plan check. Your saved plan is{" "}
              <strong>{plans[plan as Plan].label}</strong>. If you recently
              upgraded or downgraded, try refreshing the page.
            </p>
          </Banner>
        )}

        {actionData?.message && (
          <Banner tone={actionData.ok ? "success" : "critical"}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="200">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingLg">
                Current plan
              </Text>
              <Badge tone="info">{plans[plan as Plan].label}</Badge>
            </InlineStack>
            <Text as="p" tone="subdued">
              {retentionDays}-day event history. Change anytime. Charges are
              billed through your Shopify invoice, not a separate card.
            </Text>
          </BlockStack>
        </Card>

        <InlineStack gap="400" wrap align="start">
          {(["free", "paid", "premium"] as Plan[]).map((p) => {
            const info = plans[p];
            const current = plan === p;
            return (
              <Box
                key={p}
                padding="500"
                background={current ? "bg-surface-selected" : "bg-surface"}
                borderColor={current ? "border-focus" : "border"}
                borderWidth="025"
                borderRadius="300"
                minWidth="260px"
              >
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h3" variant="headingMd">
                      {info.label}
                    </Text>
                    {current && <Badge tone="success">Current</Badge>}
                  </InlineStack>
                  <Text as="p" variant="heading2xl">
                    ${info.price}
                    <Text as="span" variant="bodySm" tone="subdued">
                      {" "}
                      / month
                    </Text>
                  </Text>
                  <List type="bullet">
                    {PLAN_FEATURES[p].map((f) => (
                      <List.Item key={f}>{f}</List.Item>
                    ))}
                  </List>
                  {!current && (
                    <Form method="post">
                      <input
                        type="hidden"
                        name="intent"
                        value={p === "free" ? "downgrade_free" : "upgrade"}
                      />
                      <input type="hidden" name="plan" value={p} />
                      <Button
                        submit
                        loading={submitting}
                        variant={p === "free" ? "secondary" : "primary"}
                        fullWidth
                      >
                        {p === "free"
                          ? "Switch to Free"
                          : `Upgrade to ${info.label}`}
                      </Button>
                    </Form>
                  )}
                </BlockStack>
              </Box>
            );
          })}
        </InlineStack>

        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">
              How billing works
            </Text>
            <Text as="p" tone="subdued">
              Upgrades route through Shopify's charge approval page. You
              confirm the charge there and Shopify redirects you back once
              approved. Charges appear on your regular Shopify invoice.
            </Text>
            {IS_TEST && (
              <Text as="p" variant="bodySm" tone="subdued">
                This is a development store, so charges run in test mode. You
                will not be billed.
              </Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
