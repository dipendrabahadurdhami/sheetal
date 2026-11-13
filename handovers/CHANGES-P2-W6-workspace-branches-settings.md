# CHANGES P2-W5/W6 Workspace, part 1: branches, business settings, listing check-ups

- `business/backend/src/modules/branches/routes.ts` and `modules/settings/routes.ts` → `apps/workspace/backend/` (`workspace.repository.ts`,
  `workspace.service.ts`, `workspace.controller.ts`, `routes.ts`, `index.ts`). The old files are shims: `branchRoutes` and `settingsRoutes` register
  nothing; `checkScopes()`, `SECTIONS`, `MASK`, `CHECKUP_DEFAULTS` are still exported. `app.ts` registers `workspaceRoutes` with `contextOf: businessContextOf`.
- Same routes, answers, messages and audit strings. Every audit line is now written in the same transaction as the change.
- Migration `20261113170000_workspace_kernel_columns` (additive) on `branches`. Branches carry `version`; a change may send it (stale = 409).
- Events: `workspace.branch.added|updated|removed`, `workspace.settings.saved`, `workspace.checkup.done`.
- Workspace is NOT capped in `PHASE_ONE_CAPS` (its permissions are business-wide); a check-up still only touches listings in the branches in view.
- Not moved yet (Workspace part 2): the team (members, roles, invites), overview, import/export, forms, mail, growth.
- Tests: old tests unchanged; new `business/backend/test/workspace-kernel.test.ts`. `packages/config/src/no-old-names.test.js`: the look-alike comment in the
  old branches file is gone with the move, so its pinned entry is removed.
