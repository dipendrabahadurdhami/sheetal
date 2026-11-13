# CHANGES P2-W1-S3 (Phase 2, wave 1, stage 3: Agreements on the kernel)

Branch `phase-2/P2-W1-S3-agreements`. Same routes, answers, messages and audit strings. The website signing flow (`website/backend/src/modules/sign`) is not moved and not changed.

- `business/backend/src/modules/agreements/routes.ts` → `apps/agreements/backend/` (`agreement.repository.ts`, `agreement.service.ts`, `agreement.controller.ts`, `presenter.ts`, `mail.ts`, `schemas.ts`, `events.ts`, `scope.ts`, `routes.ts`, `index.ts`); the old file is a one-line shim.
- `business/backend/src/app.ts` registers `agreementRoutes` from `@sheetal/app-agreements/backend` with `{ prefix: "/v1", contextOf: businessContextOf }` (rule 11).
- Migration `20261113100000_agreements_kernel_columns` (additive): `version`, `updated_by`, `deleted_at`, `deleted_by` on `agreements`.
- Rows carry `version`; a draft save may send it (stale = 409). Every state change is a compare-and-set on the status (a double click or a signer signing at the same moment can't apply twice).
- Events: `agreements.agreement.created|updated|sent|reminded|cancelled|removed` (ids and reference only). New audit line `agreement.updated` for a draft save (there was none).
- Emails go out after the change is committed. A draft is still really deleted (named method `removeDraft`), as before.
- `agreements` added to `PHASE_ONE_CAPS` (today's branch view kept).
- Tests: `agreements.test.ts` unchanged; new `business/backend/test/agreements-kernel.test.ts`.

## Screens (P2-W2, same PR)
- `business/frontend/src/pages/LiveAgreements.jsx` moved to `apps/agreements/frontend/pages/AgreementsPage.jsx` on the kit (`@sheetal/ui/primitives`, `@sheetal/sdk`); the old file is a one-line shim.
- The draft still saves itself a moment after each change WITHOUT a version (last save wins), so typing never meets a 409.
- Test: `apps/agreements/frontend/pages/AgreementsPage.test.js`.
