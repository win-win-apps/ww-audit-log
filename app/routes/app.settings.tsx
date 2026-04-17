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
import { authenticate } from "../shopify.server";
import { getShopSettings } from "../utils/plan.server";
import { PLANS, type Plan } from "../utils/plan";

const prisma = new PrismaClient();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return json({
    plan: settings.plan,
    retentionDays: settings.retentionDays,
    plans: PLANS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upgrade") {
    // All paid plan changes go through Shopify managed pricing.
    // That page lets the merchant accept the charge, handles proration,
    // and Shopify notifies us via webhook when the plan changes.
    const storeHandle = session.shop.replace(".myshopify.com", "");
    const url = `https://admin.shopify.com/store/${storeHandle}/charges/audit-log-staff-activity/pricing_plans`;
    return redirect(url, { target: "_top" });
  }

  if (intent === "downgrade_free") {
    // Downgrade is free so we handle it locally. Shopify billing does
    // not need to be involved (no charge to cancel on the merchant side
    // unless they had an active paid subscription, which Shopify handles
    // via the pricing page, not here).
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { plan: "free", retentionDays: 10 },
      create: { shop: session.shop, plan: "free", retentionDays: 10 },
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
              All paid upgrades go through Shopify's billing page. You will be asked to approve the charge before anything is billed.
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
