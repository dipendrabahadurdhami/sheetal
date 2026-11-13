# CHANGES P2-W6 Workspace, part 2c: Import / Export and online forms

- `business/backend/src/modules/data/routes.ts` and `modules/forms/routes.ts` → `apps/workspace/backend/` (`data.*`, `form.*`), registered by
  `workspaceRoutes`. The old files are shims (`dataRoutes`, `formRoutes` register nothing); `app.ts` no longer registers them.
- Same routes, answers, messages, status codes and audit strings.
- Import is now ONE transaction with its audit line and event: all rows or none (before, a failure half-way left some rows). A listing import is two
  statements whatever its size (insert, then one update giving each listing its code and slug), so 2,000 rows fit easily in one transaction.
- Forms: migration `20261113180000_forms_kernel_columns` (additive: `updated_by`, `version`). A save may send `version` (stale = 409); the builder
  sends none today, so nothing changes for it. A save writes its event but no audit line (the builder saves after each change, as before). Changing who
  gets the leads now writes `form.assigned`.
- Events: `workspace.data.imported`, `workspace.form.created|saved|published|unpublished|removed`, `workspace.response.checked`.
- Cross-app writes kept as before and recorded in MODEL-OWNERS.md (Import adds listings/leads; a confirmed form payment sets the lead's value).
- Tests: old tests unchanged (`forms.test.ts`, `settings.test.ts`); new `business/backend/test/forms-data-kernel.test.ts`.
