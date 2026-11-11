# CHANGES P1-S2 (roadmap stage 1.2: Screens)

One builder, no separate QA. Branch `phase-1/P1-S2-screens`. No schema change, no migration, no new npm package.

## What changed and why

| Part | Files | What |
|---|---|---|
| Menu from manifests | `packages/config/src/menu.js` (+test), `apps/rentals/app.manifest.ts` (menu entry), `apps/expenses/app.manifest.ts` (menu icon `chart-pie`, as the old menu), `BusinessApp.jsx` | Reviews, Expenses and Rentals get their sidebar entry from their manifest. A test proves each entry shows to exactly the same roles as before, for every business type, with old and with new permission names. |
| Role screen on new names | `business/frontend/src/pages/LiveRoles.jsx`, `access/roleGrants.js` (+test), `BusinessPages.jsx` | Signed in: roles are shown and saved as `app.resource.action:scope`, one block per app, a scope picker beside a ticked permission. No "All branches" for Expenses and Reviews (cap), with a short note. The sample workspace keeps the old editor. |
| Approvals | `pages/Approvals.jsx`, `access/approvals.js` (+test), `SettingsHub.jsx`, person menu | `/business/approvals` (Waiting, Decided) and `/business/approvals/rules`. The empty inbox says rules are off. |
| Team by branch id | `access/branchAccess.js` (+test), `live.js`, `BusinessPages.jsx` | Invitations and member edits send `branchIds`; the member list is filtered by the picked branch id. |
| Support session | `packages/sdk/src/support.js` (+test), `client.js`, `pages/SupportBanner.jsx` (+test), `admin/.../OpenAsSupport.jsx` (+test), `AdminTenants.jsx` | Admin "Open as support" (password again, reason, minutes) gives one link; the token travels in the address fragment, is kept for that tab only, and the business panel shows the bar with "End session". Read-only only. |
| Try the demo | `platform/src/demo/guard.ts` (+test), `business/backend/src/modules/demo/{service,routes}.ts`, `business/backend/test/demo.test.ts`, `business/backend/src/{app,jobs}.ts`, `website/backend/src/app.ts`, `pages/TryDemo.jsx` (+test) | `POST /v1/demo/session` makes a real throw-away business (24 hours) with sample expenses and reviews and signs the visitor in. An allow-list fence refuses every write that reaches outside (invitations, mail, payments, uploads, listings) on the business API and every write on the website API. Hourly job `demo.cleanup` deletes expired demos with all their rows and users. Expenses and Reviews offer "Try the demo" instead of the old sample screens when nobody is signed in. |

## Routes registered (rule 11)
`business/backend/src/app.ts`: `registerDemoGuard`, `demoRoutes` (right after the support hook). `website/backend/src/app.ts`: `registerDemoGuard`. `platformJobs()` now also returns `demo.cleanup`.

## What I could not run here
The sandbox cannot download the Prisma engine, so database tests and the full typecheck ran first on GitHub CI. Front-end tests, lint, manifests, boundaries and `npm run build` ran locally.

## Hand test (owner, signed in with a test account)
1. Team → Roles: pick "Accountant". Blocks per app; Expenses shows the note about branches. Tick one permission, Save, reload: still ticked.
2. Person menu (top right) → Approvals: "Approvals are switched off". Rules tab lists "Confirm an expense above a limit", Off.
3. Sidebar: Reviews, Rentals, Expenses are in the same places as before.
4. Sign out, open `/business/expenses`: "Try the demo" button. Press it: a demo business with 5 expenses. Team → Invite: refused with "This is a demo".
5. Admin → Businesses → one business → "Open as support": reason + password → link → business panel with the red bar → End session.

## Follow-ups (not blocking)
- The demo button has no robot-check widget yet: when the super admin switches Turnstile on, the demo call is refused with the server's message. Add the widget before public launch (Phase 4).
- In a support session the screens show owner-level buttons; the server refuses the writes ("read-only support session"). Hiding them needs the support role in `GET /team` (Phase 2 W5, Workspace app).
- Demo businesses appear in Admin → Businesses until cleanup; a "demo" filter belongs to the admin list (stage 1.4 settings screens or Phase 3).
