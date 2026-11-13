# CHANGES P2-W2 Rentals screens on the kit

- `business/frontend/src/pages/LiveRentals.jsx` moved to `apps/rentals/frontend/pages/RentalsPage.jsx` on the kit (`@sheetal/ui/primitives`, `@sheetal/sdk`, `exportCsv`); the old file is a one-line shim.
- Every change (PUT: owner, unit, lease, bill amount, repair) sends the row's `version`; a stale page (409) closes the form and reloads.
- Wiring: `apps/rentals/package.json` exports `./frontend`; `business/frontend` depends on it; Vite alias.
- Test: `apps/rentals/frontend/pages/RentalsPage.test.js`. No old test changed.
