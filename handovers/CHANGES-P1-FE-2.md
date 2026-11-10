# CHANGES P1-FE-2: Expenses page on the kit

Branch: `phase-1/P1-FE-2-expenses-page` · Specialist: Frontend · Status: built and tested here; **CI is the first full run** (see "Not run").

## What changed, in plain words
- Business → Expenses is now `ExpensesPage` (`apps/expenses/frontend/`), made from the kit: `CrudPage`, `DataTable`, `FormBuilder`, the SDK hooks. Three tabs: **Expenses**, **Recurring**, **Profit**.
- `LiveExpenses.jsx` is one line (a re-export), so nothing else that imports it breaks. `BusinessApp.jsx` imports `ExpensesPage` for `/business/expenses`. `/business/expenses` was not in `PREVIEW`, so nothing to remove there.
- Every change to an existing record now sends its `version` (change, confirm, delete/skip, pause/resume/stop). A stale one gets 409; the page says **"Someone changed this. Reload to see the latest."** and reloads the list. It never retries by itself.
- The inline styles FE-1 left (skeleton rows, phone cards, pager, bulk bar, drawer widths, money field, file error) are classes in `shared/src/styles/platform.css`.
- Phone width (under 640 px): the table becomes cards; the buttons in a card, the toolbar, the drawer footer are at least 44 px high.

## Behaviour that is the same (checked in tests unless marked "by hand")
- "Other" needs a note (3+ letters); the label changes to "What is it for?"; the server's message is shown if it refuses. (Client check: "This is required." / "Write at least 3 characters." under the field.)
- Amount: digits only, whole rupees 1 to 2,000,000,000. Receipt: photo or PDF, 8 MB, add / replace / open / remove. Draft count on the tab and the "To confirm" card; Confirm a draft (amount can change); Skip a recurring draft, Delete a typed one (same words and texts as before).
- Recurring: Change, Pause, Resume, Stop (Stop asks first; a stopped one has no buttons).
- Profit: same stats, same VAT / commission note, same CSV columns and file name `sheetal-profit-<day>.csv`.
- Branch drop-down only when "All branches" is picked and the business has several open branches; required then; only on add.
- Hiding by permission: a person without change rights sees the list and Receipt only (by hand).

## Behaviour that is different (please read)
1. **Removing a receipt now waits for Save** (before: it was removed at once, with its own toast). Same click ("remove it"), then Save. This keeps "Cancel" honest.
2. **The Profit tab shows an error panel with "Try again"** when it cannot load (before: a toast and a blank page).
3. **Recurring rows open a view panel on click** (new); Expenses rows already can. A draft cannot be opened for Change from the panel (only Confirm / Skip), as before.
4. Delete / Skip / Stop now use the app's confirm dialog instead of the browser's `window.confirm` (same words).
5. Months outside the last 12 show "Oct 2025" instead of "2025-10" (e.g. a recurring expense started long ago).
6. Drawer default width is 560 px (what the CSS always was); the kit doc said 480. Doc corrected.

## Files
New: `apps/expenses/frontend/{index.js, pages/ExpensesPage.jsx, pages/ProfitTab.jsx, resources/{common.js, expense.jsx, recurring.jsx, profit.jsx}}`, tests `resources/{expense,profit}.test.js`, `packages/ui/src/crud/saveFlow.js` + `saveFlow.test.js`.
Changed: `apps/expenses/package.json` (`exports["./frontend"]`; `test` script now `vitest run --passWithNoTests backend`, so the app's own run does not try to load browser tests), `business/frontend/{vite.config.js, src/pages/BusinessApp.jsx, src/pages/LiveExpenses.jsx}`, `packages/ui/src/crud/{CrudPage.jsx, DataTable.jsx, Drawer.jsx, FormBuilder.jsx, ViewDrawer.jsx, formRules.js, index.js}`, `shared/src/i18n/{en.js, ne.js}` (`kit.conflict` reworded, `kit.tooShort` added), `shared/src/styles/platform.css` (appended), `docs/architecture/FRONTEND-KIT.md` (section 10).
Not touched: any `*.generated.*`, any backend file, `package-lock.json`.

## Commands (PowerShell, from the repo root)
```powershell
git checkout main; git pull; git checkout -b phase-1/P1-FE-2-expenses-page
Expand-Archive -Path "$HOME\Downloads\OUT-P1-FE-2.zip" -DestinationPath . -Force
npm install
npm run check
npm run build
```
Then, to try it: `npm run dev` and open http://localhost:5173/business/ (sign in, Expenses).

## Not run here (be plain)
- `npm install`, `npm run check` as a whole, `npm run build`, `tsc`, and the browser. In my sandbox I ran: the root Vitest files for `apps`/`packages` (108 pass: 39 new in this task), ESLint on `apps`, `packages` and `business/frontend` (clean), `scripts/check-boundaries.mjs` (ok), and a server-side render of `ExpensesPage` and a `CrudPage` for an agent with the real providers (renders without error). Clicking through the page was **not** done; the hand test below is the first real run.
- I did not have `rbac.js`, `expense.service.ts`, `BaseController` or the root `tsconfig.json` / `package-lock.json`.

## Assumptions to confirm (Lead)
1. **Permissions:** the page uses the server's `canManage` flag in the `GET /expenses` answer (as the old page did) for every change button. If the Lead wants the new `expenses.expense.create/update/delete/confirm`, `expenses.recurring.*` names checked in the browser, `rbac.js` is needed; then `can` in `ExpensesPage.jsx` is the one place to change.
2. **DELETE carries `?version=N`.** The controller reads `versionQuery(req)`; I did not see its source. If it reads the version from somewhere else (body or header), change `versionQuery` in `saveFlow.js` (one line, one test).
3. **Receipt calls (upload / open / remove) carry no version**, as the controller shows.
4. `apps/expenses/tsconfig.json` may not include `frontend/` (plain JS, so nothing to type-check). `business/frontend/package.json` does not list `@sheetal/app-expenses` as a dependency: Vite finds it through the alias in `vite.config.js` and through the workspace link; adding the dependency changes `package-lock.json`, so I left that to the Lead.
5. The Nepali for `kit.conflict` and `kit.tooShort` needs a native read. The Expenses page itself is English only, as before.
6. "Draft banner and count": the old page had the tab count, the "To confirm" card and the note inside the Confirm panel; I kept those three and added no new banner.

## Hand test for the Lead (about 15 minutes)
Use a business with at least one recurring expense that has made a draft. Do each as **owner**, then **accountant** (should be able to change), then **agent** (should see no buttons that change anything; Receipt still opens).
1. **Add:** Add expense → leave all empty → Save: errors under the fields, cursor on the first. Category "Other" with note "ab" → error; "Tea" → saves; toast "EX-000N saved."
2. **Edit:** Change a confirmed expense → change amount → Save. Cancel after typing asks "Discard your changes?".
3. **Draft:** the tab shows a count; "To confirm" card is highlighted. Confirm a draft with another amount → toast "confirmed"; count drops; Profit changes. Another draft: **Skip** → toast "skipped".
4. **Delete:** a typed expense → Delete → dialog says "Delete EX-… ? This can't be undone."
5. **Receipt:** add a PDF → Save → "Receipt" button appears and opens in a new tab. Change it to a PNG. Pick a file over 8 MB → "That file is over 8 MB." Open the expense → "remove it" → Save → button gone.
6. **Recurring tab:** New (day 29 is refused, 1 to 28 accepted) → Pause → Resume → Change → Stop (asks) → no buttons left.
7. **Profit tab:** change From / To (To never before From). Numbers and the VAT note show. Download CSV: 8 columns, file named `sheetal-profit-<today>.csv`, opens in Excel. Turn the network off, change the range: error panel with Try again.
8. **All branches vs one:** with "All branches" and 2+ branches: Branch drop-down appears when adding (required) and the list column says "Branch". Pick one branch at the top: drop-down gone, list reloads.
9. **Stale save (the 409 test):** open the same expense in two browser tabs; save in tab A; in tab B (still open) change and Save → message "Someone changed this. Reload to see the latest.", the list reloads, nothing else is sent. Repeat with Confirm and with Pause in two tabs.
10. **Look:** light, dark, red theme: no unreadable text, no layout jumps; the drawer fits.
11. **Phone width** (browser at 375 px): the list is cards; Confirm / Change / Skip / Receipt each reachable with a thumb (44 px high); the drawer is full width with Save at the bottom; the toolbar filters stack.
