# CHANGES P2-W6 Workspace, part 2b: the business Overview

- `business/backend/src/modules/overview/routes.ts` → `apps/workspace/backend/` (`overview.repository.ts`, `overview.service.ts`, `overview.controller.ts`,
  registered by `workspaceRoutes`). The old file is a shim: `overviewRoutes` registers nothing; `app.ts` no longer registers it.
- Same blocks, numbers, texts and links. Branches in view now come from the kernel context (`ctx.branches.idsFor("branch")`), the same rule as before.
- Read only: no audit line, no event, no migration. The Overview reads other apps' tables and never writes them (recorded in MODEL-OWNERS.md).
- A Sheetal support session can open the Overview (before: refused as "not signed in").
- Tests: `overview.test.ts` unchanged; new `business/backend/test/overview-kernel.test.ts`.
