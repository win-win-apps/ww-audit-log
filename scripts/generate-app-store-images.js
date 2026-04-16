/**
 * Generate App Store images for App 83 — Audit Log.
 *
 * This app is admin-only (no storefront render), so the screenshots come from
 * the embedded admin UI. You need a valid SESSION_COOKIE from the running app
 * (either local dev tunnel or fly.io prod). Grab it from Chrome devtools after
 * visiting the embedded app at least once.
 *
 * Usage:
 *   SESSION_COOKIE="..." APP_URL="https://ww-audit-log.fly.dev" \
 *     OUTPUT_DIR="../../app-store-assets" \
 *     node scripts/generate-app-store-images.js
 *
 * After raw screenshots are saved, the canva-design MCP adds the headline
 * overlay, feature callouts, and brand styling to produce the final 1600x900
 * assets.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const APP_URL = process.env.APP_URL || 'http://localhost:3001';
const SESSION_COOKIE = process.env.SESSION_COOKIE || '';
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.resolve(__dirname, '../../app-store-assets');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const shots = [
  {
    name: 'hero-timeline',
    description: 'Hero — full timeline with varied event types',
    path: '/app',
    waitFor: '[data-timeline-loaded]',
    fullPage: false,
  },
  {
    name: 'feature-1-filters',
    description: 'Filter panel open, category = orders',
    path: '/app?category=order',
    waitFor: '[data-timeline-loaded]',
    action: async (page) => {
      const btn = await page.$('[data-filter-button]');
      if (btn) await btn.click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'feature-2-event-detail',
    description: 'Event detail row expanded, showing before/after diff',
    path: '/app',
    waitFor: '[data-timeline-loaded]',
    action: async (page) => {
      const firstRow = await page.$('[data-event-row]');
      if (firstRow) await firstRow.click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'feature-3-export',
    description: 'Export CSV modal open',
    path: '/app',
    waitFor: '[data-timeline-loaded]',
    action: async (page) => {
      const exportBtn = await page.$('[data-export-button]');
      if (exportBtn) await exportBtn.click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'feature-4-settings',
    description: 'Settings page showing categories toggle and retention',
    path: '/app/settings',
    waitFor: '[data-settings-loaded]',
  },
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });

  if (SESSION_COOKIE) {
    const url = new URL(APP_URL);
    await page.setCookie({
      name: 'shopify_app_session',
      value: SESSION_COOKIE,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
    });
  } else {
    console.warn('No SESSION_COOKIE set. Some shots may 401.');
  }

  for (const shot of shots) {
    const url = APP_URL + shot.path;
    console.log(`\n--- ${shot.name} -> ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      if (shot.waitFor) {
        await page.waitForSelector(shot.waitFor, { timeout: 10000 }).catch(() => {
          console.warn(`  warn: ${shot.waitFor} not found, taking shot anyway`);
        });
      }
      if (shot.action) await shot.action(page);
      const outPath = path.join(OUTPUT_DIR, `${shot.name}.png`);
      await page.screenshot({
        path: outPath,
        fullPage: shot.fullPage === true,
        clip: shot.fullPage ? undefined : { x: 0, y: 0, width: 1600, height: 900 },
      });
      console.log(`  saved: ${outPath}`);
    } catch (err) {
      console.error(`  FAILED: ${shot.name}:`, err.message);
    }
  }

  await browser.close();
  console.log('\nDone. Next: open each png in Canva, add headline overlay, export to 1600x900.');
})();
