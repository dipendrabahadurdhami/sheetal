# Phase 2 close-out (13 Nov 2026, night, Nepal time)

Phase 2 is finished: every business app's backend is on the kernel, every business screen is on the kit, the business panel has no browser-storage
sample workspace, the website's writes into business data go through the apps, and the leftovers are done. Every stage is merged with CI green.

## What Phase 2 did (PRs)
| Wave | PRs | What |
|---|---|---|
| W1-W5 backends + screens | #18, #29-#55 | Rentals, People, Agreements, Projects, Investments, Invoicing (+ Payouts), POS + Stock, Hotel, CRM, Listings, Workspace (branches, settings, team, overview, import/export, forms, email, growth split, check-ups) on the kernel; their screens on the kit |
| W6 screens | #57-#60 | Inbox (CRM), Email, Team + Roles, Branches into `apps/<app>/frontend` |
| W6 sample removal | #61 | the business panel works on real data only: sign-in page with "Try the demo", "Add your business", error and loading pages; 35 live/sample picks gone; sample screens deleted |
| W6 last screens | #62 | Listings (+ wizard, check-ups, other sites), Settings, the invoice and payout screens into their apps; the business panel keeps only UI state (`session`, `drafts`) in the browser |
| W6 website writes | #63 | website enquiries, online-form answers and the public API create leads through the CRM app (lead + audit + event in one transaction); website signatures leave the Agreements audit trail and events |
| Leftovers + close-out | this PR | feed bookings hold the room type; a Settings tab per app; Rentals paisa columns (+ backfill, kept by a trigger) and soft delete; 19 unused shims deleted; this note |

## The leftovers in detail
- **Feed bookings** (`backend-core/src/domain/ota.ts`): each booking a calendar feed writes runs in a transaction that holds the rooms of that type at
  that branch (`holdRoomType`, the same `SELECT … FOR UPDATE` as the Hotel app's `RoomRepository.lockType`). Test: `business/backend/test/ota-hold.test.ts`.
- **Settings tab per app**: Business → Settings → App settings shows one tab per app the business has, with the settings its manifest declares with scope
  "business" (today: Expenses "Ask for approval above (Rs.)"). Saved in the typed settings store with the audit line. Backend `apps/workspace/backend/app-settings.*`,
  screen `apps/workspace/frontend/pages/AppSettingsPage.jsx`. Test: `business/backend/test/app-settings.test.ts`.
- **Rentals paisa**: migration `20261113190000_rentals_paisa` adds `*_paisa BIGINT` next to every Rentals money column, fills them (rupees × 100) and keeps
  them equal with a BEFORE INSERT OR UPDATE trigger, so no writer can forget. Readers still use rupees; Phase 3 (billing in paisa) moves them.
- **Rentals soft delete**: owners, units, payments and statements are removed with a soft delete. Every other reader learned to skip deleted rows first:
  the branch-closing check, profit, the website's "my rent", the admin rent-payment list, online-payment decisions. Saving a removed statement's month again
  brings it back. Test: `business/backend/test/rentals-paisa.test.ts`.
- **Shims**: deleted every forwarding file nothing imports (19 old route files under `business/backend/src/modules`). Kept on purpose: files old tests
  import (`modules/{expenses,hotel,stock,rentals}/routes.ts`, `mail/dns.ts`), the Business-page shims that pass panel parts into app pages, and the shared
  re-exports (`shared/src/core/ui.jsx`, `theme.js`, `contrast.js`, `components/Crud.jsx`, `business/frontend/src/api.js`).

## Owner steps
1. `.\scripts\ops\RUN-UPDATE.cmd` (it backs up first; applies `20261113190000_rentals_paisa`, additive).
2. Hand test, signed in with a test account: Inbox, Team, Branches, Listings (new + edit), Settings → App settings.
3. Signed out, open `/business`: the sign-in page with "Try the demo" shows (no sample business any more).

## Known limits, handed to Phase 3 or later
| Item | Where it goes |
|---|---|
| The panel shell still keeps a read copy of the open business (businesses, roles, members, branches, listings, settings) in memory, loaded by `live.js`; it is no longer saved in the browser | Phase 3 (entitlements and the menu move to the server's answer) |
| `shared/src/demo` stays: the website and the admin panel still read its plans, catalog and seed | Phase 3 (plans are replaced by the marketplace catalog) |
| The AI studio screen (`AI.jsx`: listing from text, lead finder drawer) still shows ready-made results without an AI account | Phase 5 (AI in every app) |
| Rentals readers still use rupees (paisa twins are ready) | Phase 3 (billing in paisa) |
| Social sharing and the voice assistant are previews | Phase 5 |
| Website free posting writes listings directly (not a Phase 2 item) | Phase 3 (listing limits per edition) |
