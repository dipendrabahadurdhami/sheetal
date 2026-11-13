# CHANGES P2-W4 Point of sale and Stock on the kernel, screens on the kit

The Stock tables are tagged `pos`, so Stock is part of the POS app.
- `business/backend/src/modules/pos/routes.ts` and `modules/stock/routes.ts` → `apps/pos/backend/` (`repositories.ts`, `pos.service.ts`, `stock.service.ts`,
  `controllers.ts`, `common.ts`, `jobs.ts`, `routes.ts`, `index.ts`). The old files are empty shims (they re-export `billCode`, `stockJob`, `startStockJob`).
  `app.ts` registers `posRoutes` from `@sheetal/app-pos/backend` with `contextOf: businessContextOf` (rule 11); `jobs.ts` takes `stockJob` from the app.
- Same routes, answers, messages and audit strings; every audit line is now written in the same transaction as the change.
- A POS bill put on a guest's room (and its void) writes the Hotel room-bill line in the same transaction: an agreed exception, in MODEL-OWNERS.md.
- Migration `20261113130000_pos_kernel_columns` (additive) on `menu_items`, `pos_bills`, `stock_items`. Shifts, stock moves (an append-only ledger) and
  recipes (replaced as a set) get no kernel columns, on purpose (see `repositories.ts`).
- Menu items and stock items carry `version`; a change may send it (stale = 409). A bill is voided once and a shift closed once (compare-and-set).
- Events: `pos.menu.added|updated`, `pos.shift.opened|closed`, `pos.bill.paid|voided`, `pos.stock.added|updated|moved|imported`, `pos.recipe.saved`.
- `pos` added to `PHASE_ONE_CAPS`. A read-only support session can no longer ring up bills or move stock.
- Screens: `LivePOS` moved out of `LiveOps.jsx` to `apps/pos/frontend/pages/PosPage.jsx`; `LiveStock.jsx` to `apps/pos/frontend/pages/StockPage.jsx` (sends
  `version`, reloads on 409). The old names are re-exports. The POS page now also reloads when the branch picked at the top changes.
- Tests: `operations.test.ts`, `stock.test.ts`, `jobs.test.ts` unchanged; new `business/backend/test/pos-kernel.test.ts` and `apps/pos/frontend/pages/screens.test.js`.
  `packages/config/src/no-old-names.test.js`: the look-alike `pos.void` audit string left the old POS file (the guard doesn't scan apps/), so its entry is removed.
