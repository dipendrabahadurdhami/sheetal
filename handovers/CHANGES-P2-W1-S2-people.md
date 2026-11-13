# CHANGES P2-W1-S2 (Phase 2, wave 1, stage 2: People on the kernel)

One builder. Branch `phase-2/P2-W1-S2-people`. Same pages, same answers, same messages, same audit action strings.

## What moved
| Before | Now |
|---|---|
| `business/backend/src/modules/people/routes.ts` (334 lines, Prisma in the routes) | `apps/people/backend/`: `repositories.ts` (tables), `people.service.ts` (rules), `people.controller.ts` (HTTP), `time.ts` (days), `schemas.ts`, `events.ts`, `scope.ts`, `routes.ts`, `index.ts` |
| old route file | one-line shim (deleted at the end of Phase 2) |

`business/backend/src/app.ts` registers `peopleRoutes` from `@sheetal/app-people/backend` with `{ prefix: "/v1", contextOf: businessContextOf }` (rule 11).

## What is new
- Kernel columns on `attendance`, `leave_types`, `leave_requests` (migration `20261113090000_people_kernel_columns`, additive, no row changed): `version`, `created_by`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by`.
- Rows in the answers carry `version`. A fix, a leave-type edit or a decision may send it: a stale one answers 409; no version saves as today.
- Events in the same transaction as the change: `people.attendance.checked_in`, `.checked_out`, `.corrected`, `people.leave.requested`, `.decided`, `.cancelled` (declared in the manifest).
- Leave approval is approvable: manifest `approvals` entry on `people.person.update` (an approval is named by its permission, check-manifests rule 2), **off by default**.
  With the rule off, nothing changes. A business that switches it on gets "Sent for approval" (202) and a second manager decides. A rejection is never held.
- `people` added to `PHASE_ONE_CAPS` (`platform/src/core/scope-cap.ts`): everyone keeps today's view (picked branch, or all of theirs).
- Taking a leave request and deciding it now use a compare-and-set (`pending -> approved`), so two managers deciding at the same moment can't both win.
- A read-only staff support session can no longer change attendance or leave (the kernel refuses every write in such a session).

## Tests
- `people.test.ts` unchanged.
- New: `apps/people/backend/test/pure.test.ts` (day rules), `business/backend/test/people-kernel.test.ts` (kernel columns, events, 409, isolation, approval rule off and on).
- Root `npm test` and `npm run typecheck` include `@sheetal/app-people`.

## Owner step
`RUN-UPDATE` applies the migration (it backs up first). Nothing else.
