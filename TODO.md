# TODO

## Blockers

- **fly.io URL from Shane.** Submission cannot be completed until Shane deploys and returns `https://collection-auto-sort.fly.dev` (or whatever he ends up with). Required before Partner Dashboard submission form can be filled.
- **Shane needs to set secrets**: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `DATABASE_URL`, `CRON_SECRET`. Fly deploy will come up with blank state until these are set via `fly secrets set`.
- **Cron schedule machine.** After first deploy, Shane needs to create a fly.io scheduled machine that hits `/api/cron/run-all` every 30 minutes with `Authorization: Bearer $CRON_SECRET`. Without this, the "daily" and "hourly" schedules are cosmetic.

## Next Up

- **End-to-end smoke test on dev store** after Shane confirms deploy: install app, create a rule against a manual collection with >10 products, hit Run Now, verify products reorder in admin.
- **Test `too_large` guard.** Need a manual collection with >5000 products to confirm the engine politely refuses instead of hanging.
- **Sold out + pinned interaction.** Write a test path that confirms a pinned-to-position-1 product does not get pushed to the bottom even if it's sold out.

## Nice-to-Have

- **Preview mode.** Let merchants see the reorder diff before applying. Would need a new engine entry point that returns the diff without calling `collectionReorderProducts`.
- **Per-rule run log CSV export.** Merchants who want to audit what changed over time.
- **Smart collection support via client-side re-render.** Out of scope unless a paid customer asks, but the theoretical path is a theme extension that sorts the rendered liquid on page load.
- **Bulk rule application.** One rule applied to N collections at once (e.g. all collections tagged `seasonal`).
