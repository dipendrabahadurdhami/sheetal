# CHANGES P3-FE-2: the upgrade prompt kit, one error mapper, useEntitlements

Phase 3, stage 14. MB sections 6.3 and 14.2. The same prompts and words in every app; mounted only for a business on `apps` (and the
upgrade panel, without the 80% banner, on `shadow`). A business on today's plans sees exactly what it saw before.

## What
- `packages/ui/src/billing/errors.js`: **one mapper** `billingErrorOf()` for `limit_reached`, `subscription_read_only`, `app_not_available` and the
  old `seat_limit`, `listing_limit`, `app_limit`, `plan_feature`, `upgrade_needed` (one shape: kind, app, key, limit, used, next edition, price);
  a small bus (`reportBillingError`, `onBillingError`, `shownAsPrompt`); the 80% banner rule (`bannerVisible`: from 80%, hidden 7 days after
  "Hide", never over a form); `appOfPath()` (which app a business page belongs to).
- `packages/ui/src/billing/Prompts.jsx`: `LimitBanner`, `UpgradePanel` (what happened, the exact numbers, the next edition and its price,
  Upgrade / Not now; a card at the bottom corner, **never a modal**), `BillingPrompts` (shows the panel when any API call fails with a billing
  error), `EditionBadge` ("Full" chip → the marketplace drawer), `AiLocked` (sample + "Turn on AI", no model call), `ReadOnlyBanner`
  ("Your {App} subscription has ended/is paused. Everything is safe." + Renew + Export my data). Exported as `@sheetal/ui/billing`.
- `packages/sdk/src/client.js`: `ApiError` keeps the server's `details`; every failed call is reported to the bus (nothing changes when no panel
  is mounted). `packages/ui/src/primitives.jsx` `ToastProvider`: skips a toast whose text the panel is already showing (the panel replaces the
  failed action's toast, for every screen at once).
- `packages/sdk/src/hooks.js`: `useEntitlements()` and its plain part `entitlementsView()` (accessOf, hasApp, editionOf, limitOf, seats, ai). On plans
  or while loading every app counts as there, so nothing is hidden by mistake (the server still refuses what isn't allowed).
- `business/frontend/src/billingMode.js`: `useBusinessEntitlements()` from the same single `/entitlements` request.
- `BusinessApp.jsx` on `apps`: the menu shows only the apps the business has (by `appOfPath`); the old plan's Free/paid gating is off (apps decide);
  `ReadOnlyBanner` at the top of a read-only or paused app; `BillingPrompts` mounted (also on `shadow`).
- Texts: `bp.*` keys in `shared/src/i18n/en-market.js` and `ne-market.js` (the FE-1 test checks every key has Nepali with the same placeholders).
- `shared/src/core/plans.js` is unchanged: it still serves businesses on `plans`.

## Tests
`packages/ui/src/billing/billing.test.jsx` (28): the mapper with every error body (new and old codes, odd details ignored); the bus and the toast it
replaces (and nothing skipped when no panel is mounted); the API client keeps `details` and reports a 402; the banner's 80% / 7-day / form rules and
its numbers; `UpgradePanel` with each of the 10 error bodies (says what happened, `role="alert"`, never `aria-modal`); the exact numbers, next edition
and price; read only → billing; `ReadOnlyBanner`, `AiLocked` (no fetch), `EditionBadge`; `appOfPath`; `entitlementsView` on apps vs plans.
Run on the owner's PC: root front-end 326/328 (the 2 are the known Windows-only `no-old-names.test.js`), lint, boundaries, business, admin and
website builds. No server code changed.

## Not in this stage
- **Where each app puts `LimitBanner`**: the banner needs the page's own count (`used`); `/entitlements` gives the limit only. Apps add
  `<LimitBanner appId used limit>` on their list pages as they are touched (or after a small "usage" addition to `/entitlements`).
- The "Upgraded. {n} items are now available" toast after an upgrade.
- `EditionBadge` and `AiLocked` are ready but not yet placed on specific buttons (FE-6 wires the AI buttons).

## Hand test (pilot business on `apps`)
Add rooms in Hotel up to the free limit, then one more: the panel appears bottom right with "5 of 5 used" and the full edition's price; no
toast. The same for Expenses (expenses this month) and Team invites (seats, the old `seat_limit` code). End a subscription: the app's pages show
the read-only banner.

## Go back
Revert, or keep the business on `plans`: nothing is mounted and every message stays a toast.
