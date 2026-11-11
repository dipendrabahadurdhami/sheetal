# CONTINUE Phase 1 (rest): where it stands (11 Nov 2026, late evening Nepal time)

Phase 1 (rest) is too big for one reply. This note is the stop at a merged, green stage boundary. The next "next" continues the SAME phase.

## Done (merged, CI green)
| Stage | PR | State |
|---|---|---|
| 1.2 Screens | #20 (`2b78546`) | merged. 1047 tests (1013 + 34). Menu from manifests, role screen on new names with scopes, Approvals inbox and rules, team by branch id, support-session bar + admin "Open as support", "Try the demo" (route, fence, hourly cleanup, button). Notes: `CHANGES-P1-S2-screens.md`. |

## Next, in this order (one branch and PR each)
1. **1.3 Integration Center** (INTEGRATIONS.md sections 2-12, 14). Suggested split so each part merges green:
   - 1.3a: tables (`IntegrationConnection`, `IntegrationSecretSet`, `IntegrationDocument`, `IntegrationTestLog`, `HelpGuide`, all `/// @app workspace`) + migration,
     vault v2 (`seal/open` with `aad`, still reads v1), interface + registry + state machine + test log, generic routes + the three alias routes
     (`/admin/settings/integrations/:id` GET, PUT, POST test), `integrations:migrate` (idempotent, copies sealed strings unopened, deletes nothing).
   - 1.3b: adapters eSewa, Khalti, Fonepay (thin classes over the existing `lib/payments.ts` functions, unchanged), Google, WhatsApp, Cloudflare with fake-fetch tests;
     spec-only shells for the rest; health job; `gateways()` reads the platform connections and falls back to the old row.
   - 1.3c: screens replacing `AdminIntegrations.jsx` (list, detail, Test / Live tabs, test log, Go live / Pause, Business requests tab).
2. **1.4 Settings** (SETTINGS.md 2-8; FRONTEND-KIT 9).
3. **1.5 New names everywhere** (ACCESS 6.3): switch call sites, remove the alias layer (server + `shared/src/core/rbac.js`), grep test. `packages/config/src/menu.test.js`
   compares old and new names through the alias layer: when the layer goes, keep the "new names" half of that test.
4. **1.6 Close** (shims, old role scripts, `setup-db` to `platform/test`, `RUN-P1-ROLES`, `update.ps1` squash-merge fix, close-out note). Ask the owner before the real role rewrite.

## Decisions made in 1.2 (keep)
- Approvals has no sidebar entry (the menu must stay the same as before): it is in the person menu and in Settings → Approvals.
- The support token travels in the address fragment (`/business#support=…`) and lives in `sessionStorage` of that tab only (`packages/sdk/src/support.js`).
- A demo visitor is a real user on the reserved domain `@demo.sheetal.invalid`; the fence is an allow-list (`platform/src/demo/guard.ts`, `DEMO_ALLOW` in
  `business/backend/src/modules/demo/routes.ts`). A new write route is closed to demos until it is added there on purpose.
- Demo businesses use the `<type>-business` plan with no renewal date, so the billing run (which needs `renewsAt`) never bills them.

## Open follow-ups from 1.2
- Robot-check widget on the "Try the demo" button (only matters once the super admin switches Turnstile on). Phase 4.
- Support session: the screens show owner-level buttons; the server refuses the writes. Hide them when Workspace moves into `apps/` (Phase 2 W5).
- Admin → Businesses lists demo businesses until cleanup (up to 24 hours). Add a filter with the settings screens (1.4).

## How this sandbox works (for the builder)
- The Prisma engine cannot be downloaded here: no `prisma generate`, no database tests, and local `tsc` shows hundreds of unrelated errors. **CI is the first real run.**
  Front-end tests (`npx vitest run`), lint, `gen:permissions`, `check:manifests`, `check:boundaries`, `check:schema` and `npm run build` do run locally.
- A migration must be written by hand to match `schema.prisma` exactly (copy the style of the newest folder in `backend-core/prisma/migrations`); CI's
  `prisma migrate diff --exit-code` is the judge.
- A pure platform test can be run locally with a throw-away vitest config inside the repo that lists only that file (the platform config starts PostgreSQL).
