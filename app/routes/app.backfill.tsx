import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  InlineStack,
  Badge,
  List,
} from "@shopify/polaris";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { getShopSettings, normalisePlan } from "../utils/plan.server";
import { runBackfill } from "../utils/backfill.server";

const prisma = new PrismaClient();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  const plan = normalisePlan(settings.plan);

  // Backfill is a Paid feature. Free plan members get kicked to billing.
  if (plan !== "paid") {
    return redirect("/app/billing?from=backfill");
  }

  return json({
    plan,
    installedAt: settings.createdAt.toISOString(),
    lastBackfillAt: settings.lastBackfillAt?.toISOString() || null,
    lastBackfillCount: settings.lastBackfillCount ?? null,
  });
};

type BackfillActionResult = {
  ok: boolean;
  message: string | null;
  inserted: number | null;
  pagesFetched: number | null;
  hitCap: boolean;
  fromDate: string | null;
  toDate: string | null;
};

function failResult(message: string): BackfillActionResult {
  return {
    ok: false,
    message,
    inserted: null,
    pagesFetched: null,
    hitCap: false,
    fromDate: null,
    toDate: null,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  const plan = normalisePlan(settings.plan);

  if (plan !== "paid") {
    return json<BackfillActionResult>(
      failResult("Backfill is a Paid plan feature. Upgrade on the Billing page."),
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const confirm = String(formData.get("confirm") || "");
  if (confirm !== "yes") {
    return json<BackfillActionResult>(
      failResult("You need to confirm before running the backfill."),
    );
  }

  try {
    const result = await runBackfill({
      shop: session.shop,
      installedAt: settings.createdAt,
      graphql: admin.graphql,
    });

    await prisma.shopSettings.update({
      where: { shop: session.shop },
      data: {
        lastBackfillAt: new Date(),
        lastBackfillCount: result.inserted,
      },
    });

    return json<BackfillActionResult>({
      ok: true,
      message: null,
      inserted: result.inserted,
      pagesFetched: result.pagesFetched,
      hitCap: result.hitCap,
      fromDate: result.fromDate,
      toDate: result.toDate,
    });
  } catch (err: any) {
    console.error("backfill failed:", err);
    return json<BackfillActionResult>(
      failResult(
        err?.message ||
          "Backfill failed. This sometimes happens if the app was just deployed and access scopes are still propagating. Try again in a minute.",
      ),
    );
  }
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function BackfillPage() {
  const { installedAt, lastBackfillAt, lastBackfillCount } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const running = nav.state === "submitting";

  return (
    <Page title="Backfill history" backAction={{ url: "/app/billing" }}>
      <BlockStack gap="500">
        {actionData?.ok && (
          <Banner tone="success" title="Backfill complete">
            <BlockStack gap="100">
              <Text as="p">
                Imported <strong>{actionData.inserted}</strong> historical events
                from Shopify across {actionData.pagesFetched} page
                {actionData.pagesFetched === 1 ? "" : "s"}.
              </Text>
              {actionData.hitCap && (
                <Text as="p">
                  The per run cap was reached. Run the backfill again to fetch
                  more events.
                </Text>
              )}
              <InlineStack gap="200">
                <Link to="/app">Open timeline</Link>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}

        {actionData && actionData.ok === false && actionData.message && (
          <Banner tone="critical">
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingLg">
                Import past events
              </Text>
              {lastBackfillAt ? (
                <Badge tone="success">Ran</Badge>
              ) : (
                <Badge tone="attention">Not run yet</Badge>
              )}
            </InlineStack>
            <Text as="p" tone="subdued">
              Shopify stores a 1 year history of admin events. The app can pull
              that history into your audit log so you have a complete timeline
              from before you installed, not just from install day forward.
            </Text>

            <BlockStack gap="100">
              <Text as="p" variant="bodyMd">
                <strong>What gets imported</strong>
              </Text>
              <List type="bullet">
                <List.Item>Product and variant changes</List.Item>
                <List.Item>Collection edits</List.Item>
                <List.Item>Orders, refunds, fulfillments</List.Item>
                <List.Item>Customer updates</List.Item>
                <List.Item>Theme edits and shop settings</List.Item>
                <List.Item>Discounts, locations, markets, domains</List.Item>
              </List>
            </BlockStack>

            <BlockStack gap="100">
              <Text as="p" variant="bodyMd">
                <strong>Things to know</strong>
              </Text>
              <List type="bullet">
                <List.Item>
                  Shopify does not expose specific staff names for historical
                  events. Imported rows are attributed to the app that made the
                  change, or to "User action (backfilled)".
                </List.Item>
                <List.Item>
                  The import covers the window from{" "}
                  {formatDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())}{" "}
                  up to your install date ({formatDate(installedAt)}).
                </List.Item>
                <List.Item>
                  Big stores may hit a per run cap of 5,000 events. In that
                  case just click Run again to fetch the next batch.
                </List.Item>
              </List>
            </BlockStack>

            {lastBackfillAt && (
              <Banner tone="info">
                <p>
                  Last backfill ran on {formatDate(lastBackfillAt)} and imported{" "}
                  <strong>{lastBackfillCount ?? 0}</strong> events. Running it
                  again will fetch any events that were not imported previously,
                  but may also duplicate events in the overlap window.
                </p>
              </Banner>
            )}

            <Form method="post">
              <input type="hidden" name="confirm" value="yes" />
              <Button submit variant="primary" loading={running}>
                {lastBackfillAt ? "Run backfill again" : "Run backfill"}
              </Button>
            </Form>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
