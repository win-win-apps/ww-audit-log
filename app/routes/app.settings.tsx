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
import { PLANS, type Plan } from "../utils/plan";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);

  return json({
    plan: settings.plan,
    retentionDays: settings.retentionDays,
    plans: PLANS,
  });
};

export default function SettingsPage() {
  const { plan, retentionDays, plans } = useLoaderData<typeof loader>();

  return (
    <Page title="Settings" backAction={{ url: "/app" }}>
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingLg">
                Your plan
              </Text>
              <Badge tone="info">{plans[plan as Plan].label}</Badge>
            </InlineStack>
            <Text as="p" tone="subdued">
              You are on the {plans[plan as Plan].label} plan with{" "}
              {retentionDays}-day event history. To change plans or view pricing,
              go to the Billing page.
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
              Events older than {retentionDays} days are automatically deleted.
              Upgrade for longer retention.
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
