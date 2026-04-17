import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  ButtonGroup,
  TextField,
  Checkbox,
  InlineStack,
  Banner,
  Box,
  Divider,
} from "@shopify/polaris";
import { useState } from "react";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { getShopSettings, PLANS, type Plan } from "../utils/plan.server";

const prisma = new PrismaClient();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return json({
    plan: settings.plan,
    retentionDays: settings.retentionDays,
    alerts: JSON.parse(settings.alertsJson),
    plans: PLANS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upgrade_paid" || intent === "upgrade_premium") {
    // Kick off Shopify billing. In dev, just set plan locally.
    const newPlan = intent === "upgrade_paid" ? "paid" : "premium";
    const retention = PLANS[newPlan as Plan].retention;
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { plan: newPlan, retentionDays: retention },
      create: { shop: session.shop, plan: newPlan, retentionDays: retention },
    });
    return json({ ok: true, message: `Upgraded to ${PLANS[newPlan as Plan].label}` });
  }

  if (intent === "downgrade_free") {
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { plan: "free", retentionDays: 10 },
      create: { shop: session.shop, plan: "free", retentionDays: 10 },
    });
    return json({ ok: true, message: "Switched to Free plan" });
  }

  if (intent === "save_alerts") {
    const enabled = formData.get("alerts_enabled") === "on";
    const recipients = String(formData.get("alerts_recipients") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const categories = (formData.getAll("alert_categories") || []).map(String);
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { alertsJson: JSON.stringify({ enabled, recipients, categories }) },
      create: { shop: session.shop, alertsJson: JSON.stringify({ enabled, recipients, categories }) },
    });
    return json({ ok: true, message: "Alert settings saved" });
  }

  return json({ ok: false, message: "Unknown action" });
};

export default function SettingsPage() {
  const { plan, retentionDays, alerts, plans } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(alerts.enabled);
  const [recipients, setRecipients] = useState<string>((alerts.recipients || []).join(", "));

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
              You are on the <strong>{plans[plan as Plan].label}</strong> plan with {retentionDays}-day history.
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
                      <Text as="p" variant="headingLg">${info.price}<Text as="span" variant="bodySm" tone="subdued"> / month</Text></Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {p === "free" && "Products, inventory, orders. 10-day history."}
                        {p === "paid" && "All events. 1-year history. CSV + JSON export. Email alerts."}
                        {p === "premium" && "Everything in Pro. 10-year history. Custom alert rules. Priority support."}
                      </Text>
                      {!current && (
                        <Form method="post">
                          <input type="hidden" name="intent" value={p === "free" ? "downgrade_free" : `upgrade_${p}`} />
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
          </BlockStack>
        </Card>

        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save_alerts" />
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">Email alerts</Text>
              <Checkbox
                label="Send me an email when a critical event happens"
                checked={alertsEnabled}
                onChange={setAlertsEnabled}
                name="alerts_enabled"
              />
              {alertsEnabled && (
                <>
                  <TextField
                    label="Send alerts to"
                    helpText="Comma-separated list of email addresses"
                    value={recipients}
                    onChange={setRecipients}
                    name="alerts_recipients"
                    autoComplete="email"
                  />
                  <Text as="p" variant="bodySm" tone="subdued">
                    Alerts fire for: product deletions, inventory hitting zero, theme publishes, and order cancellations.
                  </Text>
                </>
              )}
              <Divider />
              <Box>
                <Button submit variant="primary">Save alert settings</Button>
              </Box>
            </BlockStack>
          </Form>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingLg">Data retention</Text>
            <Text as="p" tone="subdued">
              Events older than {retentionDays} days are automatically deleted. Upgrade to keep history longer.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
