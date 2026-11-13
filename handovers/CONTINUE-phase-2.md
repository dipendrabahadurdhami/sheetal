# CONTINUE Phase 2: FINISHED (13 Nov 2026, night). See CLOSE-OUT-phase-2.md. Kept as history.

Stopped at a merged, green boundary. Pattern for every app (follow it exactly): `apps/<app>/backend` on the kernel (repository = only table code, service = rules
in ONE transaction with audit line + event, controller = HTTP only, `scope.ts` capped in `PHASE_ONE_CAPS`), additive migration with the kernel columns,
old route file -> one-line shim, `app.ts` registers the app's routes with `contextOf: businessContextOf`, old tests unchanged, new `<app>-kernel.test.ts`;
screens: `apps/<app>/frontend/pages/<App>Page.jsx` on `@sheetal/ui` + `@sheetal/sdk` (use `/tmp/port.py`-style move: kit primitives, `useApiGet`,
`exportCsv`, send `version`, reload on 409), old Live page -> one-line shim, `apps/<app>/package.json` exports `./frontend`, business frontend
dependency + Vite alias, a source test next to the page. Root `npm test`/`typecheck` list every app package. When an app is capped, `platform/test/support-and-catalog.test.ts` lists it. The old-name guard (`packages/config/src/no-old-names.test.js`) reads git-tracked files only: `git add` new files before running it locally.

## Done (merged, CI green)
| Wave | App | PRs |
|---|---|---|
| W1 | Rentals backend | #18 (earlier) |
| W1 | People backend (attendance, leave; leave approval approvable on `people.person.update`, rule OFF) | #29 |
| W1 | Agreements backend (website signing unchanged) + screens | #31 |
| W2 | People screens | #30 |
| W2 | Rentals screens | #32 |
| W3 | Projects (units, holds, reservations + their payments) and Investments (pledges, updates): backend + screens | #34 |
| W3 | Invoicing: customer invoices (backend + live page) and payouts (read only) | #36, #37 |
| W3 | Collections: settled as part of Projects (manifest note; MODEL-OWNERS.md) | #34, #36 |
| W4 | POS app: point of sale and Stock (backend + screens; the low-stock job) | #39 |
| W4 | Hotel: rooms, calendar, bookings, front desk (backend + screens; bookings hold the room type, so no double booking at the same moment) | #41 |
| W5 | CRM: the Inbox (backend; who sees which lead pinned by a test). Screen stays on the panel store until W6 | #43 |
| W5 | Listings: a business's listings (backend). Screens stay on the panel store until W6 | #45 |
| W6 | Workspace part 1: branches, business settings, listing check-ups (backend) | #47 |
| W6 | Workspace part 2a: the team (members, roles, invites, profile, branding, Pro cover; every refusal tested, support sessions too) | #50 |
| W6 | Workspace part 2b: the business Overview (read only); `ChannelAccount` owner decided (workspace) | #51 |
| W6 | Workspace part 2c: Import / Export (all rows or none) and online forms (kernel columns on forms) | #52 |
| W6 | Workspace part 2d: business email (setup audited, support sessions read only) | #53 |
| W6 | Listing check-ups into apps/listings (with the 15-minute job; first tests for them) | #55 |
| W6 | Workspace part 2e: growth split by owner (Workspace analytics/channels, CRM lead finder + Meta webhook, Hotel feeds/iCal/other-site requests) | #54 |
| W6 screens | Inbox -> `apps/crm/frontend/InboxPage` (leads + team from the API, `version` on changes, lead finder passed in as `Finder`) | #57 |
| W6 screens | Email -> `apps/workspace/frontend/MailPage` (shim passes the top bar's re-count) | #58 |
| W6 screens | Team -> `TeamPage` (loads /team + /branches itself, branch ids, seat limit from the server) and Roles -> `RolesPage`; `branchAccess` -> `@sheetal/sdk/branchAccess`, `roleGrants` -> apps/workspace/frontend (shims at old paths) | #59 |
| W6 screens | Branches -> `BranchesPage` (loads /branches + /team itself, `version` on edit and close/reopen; `live.js` `branchesRefresh()`) | #60 |

| W6 | Sample workspace removed from the business panel | #61 |
| W6 | Listings, Settings, invoice screens into their apps; only UI state in the browser | #62 |
| W6 | Website writes of business data on the kernel (leads, signing) | #63 |
| Leftovers | Feed bookings hold the room type; Settings tab per app; Rentals paisa + soft delete; shims deleted; close-out | #64 |

## Owner steps after these merges
`RUN-UPDATE` (applies migrations `20261113090000_people_kernel_columns`, `20261113100000_agreements_kernel_columns`, `20261113110000_projects_kernel_columns`,
`20261113110100_investments_kernel_columns`, `20261113120000_invoicing_kernel_columns`, `20261113130000_pos_kernel_columns`, `20261113140000_hotel_kernel_columns`, `20261113150000_crm_kernel_columns`, `20261113160000_listings_kernel_columns`, `20261113170000_workspace_kernel_columns`; all additive, it backs up first).
