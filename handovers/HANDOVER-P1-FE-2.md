# HANDOVER P1-FE-2
Specialist: Frontend
Phase / step: Phase 1, step 9 (front-end packages), task P1-FE-2
Status: done (not yet run by CI or clicked through in a browser; see CHANGES "Not run")

## What I did
- Built `ExpensesPage` (Expenses / Recurring / Profit) in `apps/expenses/frontend/` on `CrudPage`, `DataTable`, `FormBuilder` and the SDK hooks; the two list tabs are plain data (`resources/expense.jsx`, `resources/recurring.jsx`).
- Wired `/business/expenses` to it (`BusinessApp.jsx`), made `LiveExpenses.jsx` a one-line re-export, added `exports["./frontend"]` to `apps/expenses/package.json` and a Vite alias.
- Added optimistic-concurrency to the kit: `resource.versioned` sends `version` on PUT / confirm / actions / delete; 409 shows "Someone changed this. Reload to see the latest." and reloads (`packages/ui/src/crud/saveFlow.js`).
- Moved the inline styles into `platform.css` (`pf-skel`, `pf-cards`, `pf-card-*`, `pf-pager`, `pf-bulk`, `pf-money`, `pf-drawer-sm|lg`, phone tap targets).
- 39 new tests (version round-trip, form rules, columns, CSV); the earlier 69 pass.

## Files delivered (repo paths)
See CHANGES-P1-FE-2.md "Files". All are full files in `OUT-P1-FE-2.zip`.

## Commands the owner must run (PowerShell, in order)
1. `git checkout main; git pull; git checkout -b phase-1/P1-FE-2-expenses-page`
2. `Expand-Archive -Path "$HOME\Downloads\OUT-P1-FE-2.zip" -DestinationPath . -Force`
3. `npm install`
4. `npm run check`
5. `npm run build`

## How to check it worked
- `npm run check` green; `npm run build` green.
- Hand test in CHANGES-P1-FE-2.md (add / edit / confirm / skip, recurring, profit CSV, receipt, 3 roles, branches, 3 themes, phone width, the two-tab stale save).

## Not done / open questions
- Needs the Lead: permission names in the browser (`rbac.js`), whether DELETE reads `?version=` (`versionQuery` in the controller), tsconfig / lock file, Nepali read of two new `kit.*` texts. Details: CHANGES "Assumptions".
- Behaviour differences to accept (receipt removal waits for Save, Profit error panel, confirm dialogs, recurring view panel): CHANGES "Behaviour that is different".
- Review: still uses the old `LiveReviews`; not touched.

## Next task (for which specialist)
- P1-FE-3: Reviews page on the kit (`CrudPage` with `layout="cards"` and the reply box), for Frontend. Files that chat needs: this zip's contents (after QA + merge), `business/frontend/src/pages/LiveReviews.jsx`, `apps/reviews/app.manifest.ts` and its backend routes / presenter / schemas, the Reviews entry in `BusinessApp.jsx`, and a sample `GET /reviews` answer.
