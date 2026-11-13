# CHANGES P3-BE-3 (+ P3-QA-1 oracle and fixtures): entitlements v3, shadow mode, limits

Phase 3, stage 4. What a business may use can now come from its app subscriptions (v3) instead of its plan (v1), chosen per business by
`Tenant.billingMode`. **Every business stays on `plans`**: for them nothing changes and no query is added. MB sections 6, 7 and 8.6.

## What changed
| File | What |
|---|---|
| `platform/src/billing/entitlements.ts` (new) | v3 builder: access (full, limited, read_only, locked, none) from the dates; edition; limits raised by grants and add-ons (unlimited wins); features; seats; `requireWrite` (402 `subscription_read_only` / 403 `app_not_available`); `requireLimit` (hard, soft +20%, warn at 80%; 402 `limit_reached` with the MB 6.3 body: appId, key, limit, used, behaviour, tryEdition, tryPricePaisa) |
| `platform/src/billing/mapping.ts` (new) | rules R1-R4, R6: a plan as subscriptions and grants (the migration script BE-10 reuses it) |
| `platform/src/billing/shadow.ts` (new) | compares v1 and v3 ("less" must be zero, "more" listed); logs; one `billing.shadow_diff` audit row per business per hour |
| `platform/src/billing/load.ts` (new) | loads subscriptions, live grants, add-ons, catalog and billing settings; `entitlementsFor()` picks the builder by mode; shadow runs in the background and never breaks a request |
| `platform/src/core/context.ts` | `Entitlements` gains optional `mode`, `access`, `requireWrite`, `requireLimit` (additive) |
| `platform/src/tenancy/context.ts`, `system-context.ts` | requests and jobs use `entitlementsFor()`; v1 gets `mode: "plans"`, `access` and a `requireWrite` that never refuses |
| `platform/src/core/service.ts` | every write (`inTransaction`) calls `requireWrite(app)`; `requireLimit` uses the v3 rule for businesses on `apps` (old message for `plans`) |
| `business/backend/src/modules/entitlements/routes.ts` (new) + **`business/backend/src/app.ts` (registered)** | `GET /v1/entitlements`: mode, per app access, edition and limits, seats |

## Tests
- `platform/test/entitlements-v3.test.ts` (pure): every access mode, both refusals with their bodies, grants/add-ons only raise, features, seats.
- `backend-core/test/entitlements-contract.test.ts` with QA-1's `billing-oracle.ts` (v1 rules written by hand) and `fixtures/p3-businesses.ts`
  (5 types × 3 plans + add-ons, trial, past due, suspended): v1 equals the oracle; **v3 from the mapping never gives less than v1** (19 fixtures).
- `business/backend/test/entitlements-v3.test.ts` (database): the route in plans / apps / shadow mode; other businesses never count; a lapsed
  paid app still writes on its free edition; an uninstalled app is refused with nothing written; shadow writes its audit row.

## Not in this stage (said plainly)
- **Usage counters per app** (`used` next to each limit on `/entitlements`) come with the marketplace routes (BE-6), where the screens need them.
  Apps already pass `used` when they call `requireLimit`, so enforcement does not need them.
- `ai()` still answers "locked" for v3 (BE-8 builds AI credits and keys).

## Owner
Nothing changes on screen. Go back: set `billingMode = plans` (it already is for everyone) or revert the PR.
