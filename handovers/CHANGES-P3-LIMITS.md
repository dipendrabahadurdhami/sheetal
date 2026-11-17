# CHANGES: the apps enforce their edition's limits on app subscriptions (17 Nov 2026)

Until now the catalog's free limits (5 rooms, 20 invoices a month, …) were shown and sold but checked nowhere: no app called
`requireLimit()`, so a free business was never stopped. Listings was fixed on 16 Nov; this change wires the rest of what staff add by hand.

## The helper
`platform/src/billing/room.ts`: `requireRoom(ctx, appId, key, count, adding)`, `onApps(ctx)`, `editionCap(ctx, appId, key)`,
`monthStart(now)` (the Nepal calendar month). Only a business on `billingMode = apps` is checked, with the catalog's rule for that limit
(hard, or soft with 20% over for money-in). The refusal is the one 402 `limit_reached` answer the screens already turn into the upgrade
panel (`@sheetal/ui/billing`). The count is asked for only when the business is checked.

## Wired
| App | Limit key | Where | Counts |
|---|---|---|---|
| Hotel | `rooms` (free 5, full 40) | `hotel.service.ts addRooms` | active rooms; several added at once are counted together |
| Projects | `units` (free 50, full 1,000) | `project.service.ts addUnits` | all units |
| Rentals | `leases` (free 5) | `lease.service.ts start` | leases with status active |
| Invoicing | `invoices_per_month` (free 20, soft) | `invoice.service.ts make` | invoices made this Nepal month |
| Agreements | `agreements_per_month` (free 2) | `agreement.service.ts makeDraft` | agreements made this month |
| Point of sale | `bills_per_month` (free 100, soft) | `pos.service.ts ring` | bills this month |
| Expenses | `expenses_per_month` (free 50), `recurring_templates` (free 0) | `expense.service.ts` both `beforeCreate` | expenses this month; recurring expenses not stopped |
| Listings | `listings` (free 3, full 500) | done 16 Nov (`CHANGES-P3-FREE-TIER.md`) | |

Hotel and Projects had the old plan's check in the same place: it stays, unchanged, for a business not on apps.

## Deliberately NOT refused by a limit
- **What arrives from the public:** website leads and chats (CRM `leads`), reviews (`reviews_per_month`), online bookings and reservations
  (Collections `bookings`). A customer is never turned away because the business is on a free edition (PHASE-3-RISKS A6).
  CRM has no "add a lead by hand" route today, so there is nothing of staff's to count there.
- **Not wired yet (no single place a person adds one, or it needs a product answer):** People `staff_records`, Investments
  `open_investments` and Projects `projects` (both are listings of a kind, made through Listings), POS `outlets`, CRM `pipelines`,
  Expenses `receipt_storage_mb`, the invoice CSV import (`importRows`), seats. Listed in `docs/LAUNCH-CHECK.md`.

## Tests
- `platform/test/billing-room.test.ts` (6, pure): hard and soft limits, several at once, unlimited, a limit of 0, a business on plans is
  never checked and the count never asked, the Nepal month edge.
- `business/backend/test/app-limits.test.ts` (5, through the API): Hotel free edition takes 5 rooms and refuses the 6th (nothing
  written, the answer names the full edition); after buying full it goes through; a business on its plan is untouched; Expenses refuses a
  recurring expense on free and the 51st expense of the month (last month's do not count).
- Full suites after the change: business API 437/437, platform 327/327. Typecheck of platform and the 7 apps, lint, boundaries: green.
  Not re-run: admin API, website API, backend-core (no file of theirs changed in this stage).

## Effect on the real data
Only Sheetal Property is on apps (free editions since 16 Nov), so it is now held to these limits when it adds rooms, invoices, bills,
leases, agreements or expenses. The 14 businesses on shadow and the 2 on plans are not affected.
