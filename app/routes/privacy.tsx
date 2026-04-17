import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (_: LoaderFunctionArgs) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy, Audit Log &amp; Staff Activity</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.7; }
    h1 { font-size: 2rem; margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 40px; font-size: 0.95rem; }
    h2 { font-size: 1.2rem; margin-top: 36px; }
    a { color: #0066cc; }
    ul { padding-left: 20px; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="subtitle">Audit Log, Staff Activity &nbsp;|&nbsp; Win-Win Apps &nbsp;|&nbsp; Last updated: April 17, 2026</p>

  <p>This policy explains what data the "Audit Log, Staff Activity" Shopify app (the "App") collects, why, and how it is handled. The App is operated by Win-Win Apps ("we", "us").</p>

  <h2>1. What We Collect</h2>
  <p>When you install the App on your Shopify store, we collect and process:</p>
  <ul>
    <li><strong>Shopify session data.</strong> A shop access token and session record, stored encrypted, used only to authenticate webhook payloads and access the Shopify Admin API.</li>
    <li><strong>Event data from your store.</strong> The App subscribes to Shopify webhooks across products, inventory, collections, themes, shop settings, orders, draft orders, fulfillments, refunds, customers, discounts, locations, files, markets, and domains. For each event we store the event type, timestamp, the affected resource identifiers, a summary of what changed, and staff attribution fields where Shopify provides them. Order and customer webhook payloads are scrubbed of PII before storage.</li>
    <li><strong>Plan state.</strong> Which pricing tier your shop is on, for retention management.</li>
  </ul>

  <p>We do <strong>not</strong> collect:</p>
  <ul>
    <li>Storefront visitor data</li>
    <li>Customer payment or financial identifiers. Billing and shipping addresses, email addresses, phone numbers, and similar fields are scrubbed from stored webhook payloads before they are persisted.</li>
    <li>Payment information</li>
    <li>Anything from outside the scope you granted on install</li>
  </ul>

  <h2>2. Why We Collect It</h2>
  <p>Purely to provide the App's core feature: a searchable, filterable timeline of staff activity on your store. Event data is shown only to staff of your shop, through the embedded App interface. No data is shared with third parties, no data is used for advertising, no data is resold.</p>

  <h2>3. How Long We Keep It</h2>
  <ul>
    <li><strong>Free plan:</strong> events retained for 3 days on a rolling basis. Anything older is automatically deleted.</li>
    <li><strong>Paid plan:</strong> events retained indefinitely while the App is installed.</li>
  </ul>
  <p>You can also export your log to CSV at any time from within the App.</p>

  <h2>4. What Happens on Uninstall</h2>
  <p>When you uninstall, Shopify notifies us via the <code>shop/redact</code> webhook 48 hours later. At that point we delete all event data, settings, and session records associated with your shop from our database. You can also request earlier deletion by emailing <a href="mailto:support@wwapps.io">support@wwapps.io</a>.</p>

  <h2>5. GDPR Compliance</h2>
  <p>We implement Shopify's three mandatory compliance webhooks:</p>
  <ul>
    <li><strong>customers/data_request:</strong> audit log events referencing the given customer are returned. Because payloads are scrubbed of PII, this is effectively a list of event timestamps and types.</li>
    <li><strong>customers/redact:</strong> any audit log rows referencing the given customer are deleted.</li>
    <li><strong>shop/redact:</strong> all shop-associated data is deleted.</li>
  </ul>

  <h2>6. Data Security</h2>
  <ul>
    <li>All data is stored on managed Postgres with encryption at rest.</li>
    <li>All traffic between the App and Shopify is over HTTPS.</li>
    <li>Shopify access tokens are stored encrypted.</li>
    <li>Only the shop's authenticated staff can view their own event data through the App interface.</li>
  </ul>

  <h2>7. Your Rights</h2>
  <p>You may at any time:</p>
  <ul>
    <li>Export your event log to CSV</li>
    <li>Uninstall the App, which triggers automatic data deletion</li>
    <li>Email <a href="mailto:support@wwapps.io">support@wwapps.io</a> for early deletion, a copy of your data, or any other privacy request</li>
  </ul>

  <h2>8. Changes to This Policy</h2>
  <p>We may update this policy. The "Last updated" date at the top will reflect any changes. Material changes will be communicated via the App's admin UI on next load.</p>

  <h2>9. Contact</h2>
  <ul>
    <li>Company: Win-Win Apps</li>
    <li>Email: <a href="mailto:support@wwapps.io">support@wwapps.io</a></li>
  </ul>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
