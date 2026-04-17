import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  Box,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getShopSettings } from "../utils/plan.server";
import { PLANS, isUnlimited, normalisePlan } from "../utils/plan";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);

  return json({
    plan: normalisePlan(settings.plan),
    retentionDays: settings.retentionDays,
    unlimited: isUnlimited(settings.retentionDays),
    plans: PLANS,
  });
};

export default function SettingsPage() {
  const { plan, retentionDays, unlimited, plans } = useLoaderData<typeof loader>();

  const retentionCopy = unlimited
    ? "Your Paid plan keeps every tracked event forever. Nothing gets auto deleted."
    : `Events older than ${retentionDays} days are automatically deleted on the Free plan. Upgrade to keep your full history.`;

  return (
    <Page title="Settings" backAction={{ url: "/app" }}>
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingLg">
                Your plan
              </Text>
              <Badge tone="info">{plans[plan].label}</Badge>
            </InlineStack>
            <Text as="p" tone="subdued">
              You are on the {plans[plan].label} plan with{" "}
              {unlimited ? "unlimited" : `${retentionDays} day`} event history.
              To change plans or view pricing go to the Billing page.
            </Text>
            <Box>
              <Link to="/app/billing">
                <Button variant="primary">Manage billing</Button>
              </Link>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingLg">
              Data retention
            </Text>
            <Text as="p" tone="subdued">
              {retentionCopy}
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingLg">
              Privacy
            </Text>
            <Text as="p" tone="subdued">
              This app only records admin actions on your store. No customer
              personal data is stored.
            </Text>
            <Box>
              <Button url="/privacy" target="_blank">
                View privacy policy
              </Button>
            </Box>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
