# CONTINUE Phase 2: where it stands (13 Nov 2026, Nepal time)

Stopped at a merged, green boundary. Pattern for every app (follow it exactly): `apps/<app>/backend` on the kernel (repository = only table code, service = rules
in ONE transaction with audit line + event, controller = HTTP only, `scope.ts` capped in `PHASE_ONE_CAPS`), additive migration with the kernel columns,
old route file -> one-line shim, `app.ts` registers the app's routes with `contextOf: businessContextOf`, old tests unchanged, new `<app>-kernel.test.ts`;
screens: `apps/<app>/frontend/pages/<App>Page.jsx` on `@sheetal/ui` + `@sheetal/sdk` (use `/tmp/port.py`-style move: kit primitives, `useApiGet`,
`exportCsv`, send `version`, reload on 409), old Live page -> one-line shim, `apps/<app>/package.json` exports `./frontend`, business frontend
dependency + Vite alias, a source test next to the page. Root `npm test`/`typecheck` list every app package.

## Done (merged, CI green)
| Wave | App | PRs |
|---|---|---|
| W1 | Rentals backend | #18 (earlier) |
| W1 | People backend (attendance, leave; leave approval approvable on `people.person.update`, rule OFF) | #29 |
| W1 | Agreements backend (website signing unchanged) + screens | #31 |
| W2 | People screens | #30 |
| W2 | Rentals screens | #32 |
| W3 | Projects (units, holds, reservations + their payments) and Investments (pledges, updates): backend + screens | #34 |

## Not done yet
- W1 Rentals follow-ups: paisa columns + backfill; soft delete for owner/unit/payment/statement.
- W2: Business -> Settings tab per app.
- W3 Invoicing (`business/backend/src/modules/invoicing`, 323 lines: tax numbers per fiscal year, VAT, receipts, credit notes; it imports `bookingCode` from the hotel
  module, which must become a read through Hotel or an event) and payouts (`modules/payouts`). Collections has no server code of its own: its payments on
  reservations are written by Projects in the same transaction (see MODEL-OWNERS.md); its own read API and screen come with Invoicing.
- W4 Hotel, POS, Stock. W5 CRM (own scope MUST include unassigned leads, with a test), Listings (+ move `checkups.ts`), Workspace; decide `ChannelAccount` owner.
- W6 Website API on the kernel where it writes business data; remove the browser-storage sample workspace; delete the last shims.

## Owner steps after these merges
`RUN-UPDATE` (applies migrations `20261113090000_people_kernel_columns`, `20261113100000_agreements_kernel_columns`, `20261113110000_projects_kernel_columns`,
`20261113110100_investments_kernel_columns`; all additive, it backs up first).
