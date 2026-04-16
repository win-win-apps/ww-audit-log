import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (_: LoaderFunctionArgs) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — Collection Auto-Sort Rules</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.7; }
    h1 { font-size: 2rem; margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 40px; font-size: 0.95rem; }
    h2 { font-size: 1.2rem; margin-top: 36px; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="subtitle">Collection Auto-Sort Rules — Win-Win Apps &nbsp;|&nbsp; Last updated: April 15, 2026</p>

  <p>Win-Win Apps ("we", "our", or "us") operates the Collection Auto-Sort Rules Shopify application ("the app"). This page explains what data the app collects, how it is used, and how it is deleted.</p>

  <h2>1. Information We Collect</h2>
  <p>When you install Collection Auto-Sort Rules, we collect and store only what is required to run the app:</p>
  <ul>
    <li><strong>Shopify store URL</strong> — to identify your store.</li>
    <li><strong>Shopify access token</strong> — to read your collections and reorder products on your behalf.</li>
    <li><strong>Sort rules</strong> — the collection IDs, sort criteria, schedules, and pinned positions you configure.</li>
    <li><strong>Sort run history</strong> — timestamps, status, and before/after position snapshots for each run, shown in the History tab.</li>
  </ul>
  <p>We do not collect, process, or store any personal information about your customers (shoppers). The app never reads the customer, order, or cart objects.</p>

  <h2>2. How We Use Your Information</h2>
  <ul>
    <li>To read your collections and their products so the app can compute the sort order.</li>
    <li>To call the Shopify Admin API to reorder products inside your collections.</li>
    <li>To store sort rules and run history so you can see what the app has been doing.</li>
    <li>To run scheduled sorts in the background based on your configured schedule.</li>
  </ul>
  <p>We never sell, trade, or transfer your information to third parties.</p>

  <h2>3. Data Storage</h2>
  <p>Sessions, sort rules, and run history are stored in a secure Postgres database. Access tokens are encrypted at rest. We retain your data while the app is installed.</p>

  <h2>4. Third-Party Services</h2>
  <ul>
    <li><strong>Shopify API</strong> — to read collections and reorder products. See <a href="https://www.shopify.com/legal/privacy" target="_blank">shopify.com/legal/privacy</a>.</li>
    <li><strong>Fly.io</strong> — application hosting provider.</li>
  </ul>

  <h2>5. Data Deletion &amp; GDPR</h2>
  <p>We implement the three mandatory Shopify compliance webhooks:</p>
  <ul>
    <li><strong>customers/data_request</strong> — Collection Auto-Sort Rules stores no customer-level data, so this webhook is acknowledged with an empty response.</li>
    <li><strong>customers/redact</strong> — Same as above; no customer data to erase.</li>
    <li><strong>shop/redact</strong> — Sent 48 hours after uninstall. On receipt we permanently delete all sessions, sort rules, and run history for the shop.</li>
  </ul>
  <p>To request manual data deletion, email <a href="mailto:omar@wwapps.io">omar@wwapps.io</a>.</p>

  <h2>6. Security</h2>
  <p>We use encrypted data storage, HTTPS-only communication, and least-privilege access controls. The app only requests the Shopify scopes it needs: <code>read_products</code>, <code>write_products</code>.</p>

  <h2>7. Changes to This Policy</h2>
  <p>We may update this Privacy Policy from time to time. The "Last updated" date at the top reflects the most recent revision.</p>

  <h2>8. Contact</h2>
  <ul>
    <li>Email: <a href="mailto:omar@wwapps.io">omar@wwapps.io</a></li>
    <li>Company: Win-Win Apps</li>
  </ul>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
