# CHANGES P3-BE-1: the catalog, the billing settings and the public catalog

Phase 3, stage 3. Prices, editions, free limits, trials, add-ons and Sheetal AI plans become the typed setting `platform.catalog`; the billing day
counts and VAT become `platform.billing`. Both are edited by staff with `platform.pricing.manage` and a reason (audited). MB sections 3 and 16.
Nothing charges anyone yet (`salesEnabled` is false; every business is still on `billingMode = plans`).

## What changed
| File | What |
|---|---|
| `platform/src/billing/catalog.ts` (new) | zod schemas; `seedCatalog()` (manifests + seed); `withNewApps()` (a release only ADDS apps, editions and limit keys; a saved number is never changed); guards `catalogProblems()` (free price 0, yearly ≤ 12 × monthly, paid edition priced, every declared limit present, editions/apps can't be removed, version never goes back); `CATALOG_SETTING`, `BILLING_SETTING`; `publicCatalog()` |
| `platform/src/billing/catalog.seed.ts` (new) | MB 3.4 prices (VAT included, yearly = 10 months), soft limits (POS bills, invoices: +20%), free seats 2, seat/storage add-ons, +25 listings pack, Sheetal AI plans (Lite, Plus, Max, top-up, 100 trial credits) |
| `platform/src/settings/defs.ts` | registers the two settings |
| `platform/src/core/manifest.ts` | optional `availability` ("live" / "coming_soon") |
| 13 `apps/*/app.manifest.ts` | real first values: a `free` and a `full` edition with the limits of MB 3.4/8.2 and their features; `trialDays: 14`. Prices stay out of manifests (they are the owner's numbers, in the seed) |
| `website/backend/src/modules/catalog/apps.ts` (new) + **`website/backend/src/app.ts` (registered)** | `GET /v1/public/catalog`, no sign-in, cached 5 minutes |

The old plans (Starter / Business / Pro) are untouched: today's limits still come from the plans table (entitlements v1 never reads manifests).

## Decisions (within the design; Owner to confirm marked)
- **Mail, Promote, Payroll, Accounting, Restaurant** are catalog entries without manifests for now (Mail and Promote live; the other three
  "coming soon"). Making them manifests would move their permissions out of `workspace` and rewrite every role; that waits until their code
  moves into `apps/`. Promote's price (Rs 300) is not in MB 3.4: **Owner to confirm**.
- Expenses free edition: 50 expenses a month, no recurring, **50 MB of receipts** (MB 3.4 gives no free storage number: **Owner to confirm**).
- Listings declares `stays` (unlimited in both editions) so the migration has a place for today's Pro "stays".

## Tests
- `platform/test/catalog.test.ts` (new, pure): the seed equals the manifests; every paid edition has a seed price; yearly = 10 months; guards;
  a saved value survives a release; the public view has public fields only (scan for "verified", PAN, the company, partner, commission, internal names).
- `website/backend/test/app-catalog.test.ts` (new): the route answers signed out, uses the seed, then a saved catalog, adds a newer release's apps,
  and never carries the forbidden words.

## Owner
After RUN-UPDATE (and the API restarted): open `http://127.0.0.1:4000/v1/public/catalog` in Chrome: app cards with prices in paisa (Rs 700 = 70000).
Go back: revert the PR (no table involved).
