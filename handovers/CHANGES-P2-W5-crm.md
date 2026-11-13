# CHANGES P2-W5 CRM (the Inbox) on the kernel

- `business/backend/src/modules/leads/routes.ts` → `apps/crm/backend/` (`lead.repository.ts`, `lead.service.ts`, `lead.controller.ts`, `routes.ts`, `index.ts`).
  The old file is a shim. `app.ts` registers `leadRoutes` from `@sheetal/app-crm/backend` with `contextOf: businessContextOf` and `fetch` (rule 11).
- Same routes, answers, messages and audit string (`lead.stage`).
- **Who sees which lead** stays exactly as before and is now pinned by a test: people who can assign leads (and owners) see every lead in view; everyone
  else sees the leads given to them AND the unassigned ones, never a colleague's (`LeadRepository.mine()`, `crm-kernel.test.ts`).
- Migration `20261113150000_crm_kernel_columns` (additive) on `leads`. Lead messages are an append-only conversation: no kernel columns.
- Leads carry `version`; a change may send it (stale = 409). A reply is saved in the same transaction that marks the lead contacted.
- Events: `crm.lead.updated`, `crm.lead.stage_changed`, `crm.lead.replied`. `crm` added to `PHASE_ONE_CAPS`.
- Not moved: the Inbox screen reads the panel store (`business/frontend/src/live.js`, shared with the sample workspace) and moves in wave 6; leads made by
  the website, chat channels and the lead finder are still written where they are.
- Tests: old lead tests unchanged; new `business/backend/test/crm-kernel.test.ts`.
