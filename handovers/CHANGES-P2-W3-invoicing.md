# CHANGES P2-W3 Customer invoices (Invoicing) on the kernel; Collections settled

Same routes, answers, messages, tax numbers, VAT and audit strings. No money rule changed.

- `business/backend/src/modules/invoicing/routes.ts` → `apps/invoicing/backend/` (`invoice.repository.ts`: tables, the row lock, the INV/CN/RC counter;
  `invoice.service.ts`: rules; `invoice.controller.ts`: HTTP; `presenter.ts`; `schemas.ts`; `events.ts`; `routes.ts`; `index.ts`). The old file is a shim
  (still exports `METHODS`). `app.ts` registers `invoicingRoutes` with `contextOf: businessContextOf` (rule 11).
- The audit line is now written inside the same transaction as the change (before: just after it).
- Hotel bookings, room bills and front-desk payments are read only (manifest `dependencies.reads`). The booking code `BK-0001` is the app's own copy;
  a test checks it equals the Hotel module's.
- Migration `20261113120000_invoicing_kernel_columns` (additive) on `biz_invoices`, `biz_receipts`.
- Invoices carry `version`; a draft save may send it (stale = 409, the page reloads). A draft save also re-checks "still a draft" under the row lock.
- Events: `invoicing.invoice.drafted|sent|paid|cancelled|credited|deleted|imported` (ids, numbers, amounts; no names or PAN).
- `invoicing` added to `PHASE_ONE_CAPS`.
- Screen: the live part (`LiveInvoices`) moved to `apps/invoicing/frontend/pages/InvoicesPage.jsx` on the SDK; the invoice screen itself (`InvoicesView` in
  `Money.jsx`) is passed in as `View`, because the sample workspace still uses it until wave 6.
- Payouts (`modules/payouts`, models Payout/PayoutItem) are NOT moved yet.
- Collections: no server code of its own (payments on reservations are written by Projects in the same transaction as "sold"); its manifest header says so.
- Tests: `invoices.test.ts` unchanged; new `business/backend/test/invoices-kernel.test.ts` and `apps/invoicing/frontend/pages/InvoicesPage.test.js`.
