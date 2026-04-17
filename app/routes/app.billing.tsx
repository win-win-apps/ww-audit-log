import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
import { authenticate, PAID_PLAN } from "../shopify.server";
import { getShopSettings } from "../utils/plan.server";
import { PLANS, UNLIMITED_RETENTION, normalisePlan, isUnlimited, type Plan } from "../utils/plan";

const prisma = new PrismaClient();

// Use test charges on dev stores so we never hit a real card during development.
const IS_TEST = process.env.NODE_ENV !== "production";

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
  let resolvedPlan: Plan = normalisePlan(settings.plan);

  // Opportunistic cleanup: if the DB still has a legacy "premium" string from
  // the old 3 tier pricing, normalise it to "paid" so downstream reads stop
  // having to pass through normalisePlan. Safe to run on every load; the
  // condition rarely fires.
  if (settings.plan !== resolvedPlan && settings.plan !== "free") {
    await prisma.shopSettings.update({
      where: { shop: session.shop },
      data: { plan: resolvedPlan, retentionDays: PLANS[resolvedPlan].retention },
    });
  }

  let billingCheckFailed = false;
  try {
    const check = await billing.check({
      plans: [PAID_PLAN],
      isTest: IS_TEST,
    });
    if (check.hasActivePayment && check.appSubscriptions.length > 0) {
      // Any active sub means the store is on Paid. We don't branch by name
      // anymore because there is only one paid tier.
      if (resolvedPlan !== "paid") {
        await prisma.shopSettings.update({
          where: { shop: session.shop },
          data: {
            plan: "paid",
            retentionDays: PLANS.paid.retention,
          },
        });
        resolvedPlan = "paid";
      }
    } else if (resolvedPlan !== "free") {
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

  // Also normalise any legacy "premium" rows that snuck through before the
  // reconcile branch. Safe no op if the row is already free or paid.
  const storedPlan = normalisePlan(settings.plan);
  const finalSettings =
    resolvedPlan === storedPlan
      ? { ...settings, plan: resolvedPlan }
      : { ...(await getShopSettings(session.shop)), plan: resolvedPlan };

  const url = new URL(request.url);
  const justUpgraded = url.searchParams.get("upgraded");

  return json({
    plan: finalSettings.plan,
    retentionDays: finalSettings.retentionDays,
    plans: PLANS,
    unlimited: isUnlimited(finalSettings.retentionDays),
    billingCheckFailed,
    justUpgraded,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "upgrade") {
    try {
      // billing.request throws a redirect Response that shopify-app-remix has
      // already wrapped so App Bridge can break out of the embedded iframe to
      // Shopify's charge approval page.
      return await billing.request({
        plan: PAID_PLAN,
        isTest: IS_TEST,
        returnUrl: buildReturnUrl(request, "paid"),
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
        plans: [PAID_PLAN],
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
        "Switched to Free plan. Events older than 3 days will be cleared on the next daily cleanup.",
    });
  }

  return json({ ok: false, message: "Unknown action" });
};

const PLAN_FEATURES: Record<Plan, string[]> = {
  free: [
    "Every admin action tracked (products, orders, customers, themes, shop settings, and more)",
    "3 day rolling activity history",
    "CSV export of the visible window",
    "Filter by type, staff, and keyword",
  ],
  paid: [
    "Everything in Free",
    "Unlimited activity history, nothing ever falls off",
    "Backfill up to 1 year of events from Shopify after install",
    "Full history CSV export",
    "Priority support",
  ],
};

export default function BillingPage() {
  const { plan, retentionDays, plans, unlimited, billingCheckFailed, justUpgraded } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  const retentionLabel = unlimited
    ? "unlimited retention"
    : `${retentionDays} day retention`;

  return (
    <Page title="Billing" backAction={{ url: "/app" }}>
      <BlockStack gap="500">
        {justUpgraded && (
          <Banner tone="success">
            <p>
              Upgrade approved. You are now on the{" "}
              <strong>{plans[plan as Plan].label}</strong> plan with{" "}
              {unlimited ? "unlimited" : `${retentionDays} day`} history.
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
              {retentionLabel}. Change anytime. Charges are billed through your
              Shopify invoice, not a separate card.
            </Text>
          </BlockStack>
        </Card>

        <InlineStack gap="400" wrap align="start">
          {(["free", "paid"] as Plan[]).map((p) => {
            const info = plans[p];
            const current = plan === p;
            const retentionText =
              p === "paid" || info.retention >= UNLIMITED_RETENTION
                ? "Unlimited history"
                : `${info.retention} day rolling history`;
            return (
              <Box
                key={p}
                padding="500"
                background={current ? "bg-surface-selected" : "bg-surface"}
                borderColor={current ? "border-focus" : "border"}
                borderWidth="025"
                borderRadius="300"
                minWidth="280px"
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
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {retentionText}
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

        {plan === "paid" && (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Import past events
              </Text>
              <Text as="p" tone="subdued">
                As a Paid plan member you can backfill up to a year of events
                from Shopify. This pulls in changes that happened before the
                app was installed so your timeline is complete.
              </Text>
              <Box>
                <Link to="/app/backfill">
                  <Button variant="primary">Go to backfill</Button>
                </Link>
              </Box>
            </BlockStack>
          </Card>
        )}

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
