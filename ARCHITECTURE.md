# Collection Auto-Sort Rules — Architecture

**Status**: In Progress
**Complexity Tier**: Standard
**Last Updated**: 2026-04-15

## Overview

Collection Auto-Sort Rules lets Shopify merchants define reorder rules for their collections (best sellers first, in-stock first, newest, price, alpha, etc.), stack a secondary tiebreaker, push sold out products to the bottom, pin specific products to fixed positions, and run the whole thing on a daily or hourly schedule. The app touches only the admin surface, no theme extension, no storefront code. It uses the Shopify Admin GraphQL API (`collectionReorderProducts`) to actually move products inside a MANUAL-sort collection.

## Design Decisions

### Backend-only app, no theme extension

**Choice**: Ship this with zero theme app extensions. Everything happens server-side against the Admin API.
**Why**: The feature is "reorder the products list inside a collection". Shopify already handles rendering that list on the storefront, so adding a theme extension would only duplicate work and fight the theme. A merchant installs, sets a rule, and their existing collection page just shows the new order.
**Hub reference**: [docs/architectural/data-strategy.md](../../command-center/docs/architectural/data-strategy.md)

### Postgres + Prisma with `multiSchema`

**Choice**: Each Win-Win app owns its own Postgres schema. This one is `winwin_collection_sort`.
**Why**: Keeps multi-tenant data isolated per app on a single shared Postgres. Shane manages one DB, not ten.
**Hub reference**: [docs/architectural/data-strategy.md](../../command-center/docs/architectural/data-strategy.md)

### Offline session token for cron, not `authenticate.admin`

**Choice**: The scheduled cron endpoint `/api/cron/run-all` reads the offline access token directly from the Prisma `Session` table and calls the Shopify GraphQL endpoint via a raw fetch helper (`rawShopifyGraphql`). It does not use `authenticate.admin(request)`.
**Why**: There is no user request context during a cron run. `authenticate.admin` requires a Shopify session cookie or embedded app bridge context and will fail outside of a merchant tab. This is the same pattern we learned the hard way on App 01 (metafield sync).
**Hub reference**: [docs/code-patterns/standards.md](../../command-center/docs/code-patterns/standards.md)

### `collectionReorderProducts` batched to 250 moves

**Choice**: The reorder engine computes a target order, diffs against the current order to get a minimal list of moves, then calls `collectionReorderProducts` in batches of 250 moves per call.
**Why**: The mutation takes a `moves: [MoveInput!]!` array. Shopify rate-limits on point cost, and a huge single call risks timeouts and partial failures. Batching gives us retry granularity and fits within cost budgets.
**Hub reference**: [docs/code-patterns/standards.md](../../command-center/docs/code-patterns/standards.md)

### Refuse smart collections and non-MANUAL sort order

**Choice**: If a collection is not using `sortOrder = MANUAL`, the engine refuses with a `manual_not_supported` skipped status.
**Why**: `collectionReorderProducts` is only valid on MANUAL collections. Rather than silently failing or fighting Shopify, we surface this to the merchant and show it in the run history so they know to switch the collection's sort order in the admin or use a different collection.

### Pure sort engine, Prisma bookkeeping in a wrapper

**Choice**: `sort-engine.server.ts` is a pure function that takes a rule config and a graphql callable and returns a result. `rule-runner.server.ts` wraps it with SortRun row bookkeeping.
**Why**: Keeps the scoring / diffing / batching logic testable in isolation and keeps database writes out of the hot path.

### Cron protected by shared secret, not Shopify HMAC

**Choice**: `/api/cron/run-all` checks an `Authorization: Bearer $CRON_SECRET` header.
**Why**: The scheduler is fly.io, not Shopify, so there's no HMAC. A rotatable shared secret is the simplest thing that works and is standard practice for fly.io scheduled machines.

## Infrastructure

- **Database**: Postgres (Shane provisions, one schema per app via Prisma `multiSchema`). Stores `Session`, `SortRule`, `SortRun`.
- **Hosting**: fly.io region `yyz`, single machine, suspend-on-idle. `fly.toml` sets `auto_stop_machines = 'suspend'` and `min_machines_running = 1` so the app warms fast.
- **Cron**: fly.io scheduled machine (or supercronic) hits `/api/cron/run-all` with the shared secret. The endpoint iterates every enabled rule across every shop and runs the ones that are due.
- **Secrets managed by Shane via `fly secrets set`**: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `DATABASE_URL`, `CRON_SECRET`.

## Extension Architecture

None. This is a backend-only app. The merchant interacts with the admin embedded app, and the effect shows up on their existing collection pages.

## What We Chose NOT to Do

- **No theme app extension.** The storefront already renders the collection products list in the merchant's chosen order; building a second rendering path inside a theme extension would fight the theme and add theme-compat bugs for zero merchant-visible gain.
- **No real-time triggers.** We do not watch `inventory_levels/update` or `orders/create` webhooks. Those fire at high volume and would force us to build a real-time sort queue and cache. A scheduled daily / hourly pass is what the merchants in the 1–2 star reviews on Bestsellers reSort are asking for.
- **No custom sales tracking.** Instead of building our own orders index to compute "best sellers over the last 30 days", we reuse Shopify's native `BEST_SELLING` sortKey on `collection.products`. Saves a database and matches what the native admin UI already shows.
- **No merchant-facing writes to smart (auto) collections.** We refuse rather than trying to convert them. The cost of a silent "it did nothing" bug is much higher than an upfront "this only works on manual collections" message.
- **No AppInstallation metafield sync.** This app has no theme extension, so there is nothing for a metafield to expose. The rule state lives in Postgres and is read by the admin UI and the cron only.
