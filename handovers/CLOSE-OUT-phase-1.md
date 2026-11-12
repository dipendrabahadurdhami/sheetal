# Phase 1 close-out (12 Nov 2026, Nepal time)

Phase 1 is finished. Every stage is merged and the check on `main` is green.

| Stage | PR | What |
|---|---|---|
| 1.2 Screens | #20 | menu from manifests, role screen with scopes, approvals, support banner, "Try the demo" |
| 1.3 Integration Center | #22 | connections, sealed keys, 6 providers + 17 shells, admin screens |
| 1.4 Settings | #23 | typed settings store, revenue share + report, field builder, theme tokens |
| 1.5 New names | #26, #27 | every check and every role in the manifests' names; alias layer removed; role rewrite + proof |
| 1.6 Close-out | this PR | forwarding files deleted, test database setup moved to `platform/test`, this note |

## Stage 1.6 in detail
- Deleted 10 forwarding files in `backend-core/src` (`config`, `lib/{db,errors,notify,secrets,storage,vault}`, `domain/{expenses,rentals,rentpay}`).
  179 files now import the real module (`@sheetal/platform/...`, `@sheetal/app-rentals/...`, `@sheetal/app-expenses/...`). Import lines only; no logic changed.
- `backend-core/test/setup-db.ts` moved to `platform/test/setup-db.ts` (all vitest configs and type imports follow).
- The four old role scripts were retired in #27. `scripts/ops/RUN-P1-ROLES.cmd` was added in #27.

## Owner step (once, on each database)
1. `.\scripts\ops\RUN-UPDATE.cmd`
2. `.\scripts\ops\RUN-P1-ROLES.cmd` (type YES twice). It makes a backup first and keeps the old role lists in `roles.perms_v1`.
Until step 2 has run, people other than owners have no access. Undo: `node backend-core/scripts/rewrite-role-perms.mjs --restore`.

## Follow-ups and their state
| From | Item | State |
|---|---|---|
| 1.2 | robot-check widget on "Try the demo" | open, Phase 2 |
| 1.2 | support session shows owner buttons (server refuses) | open, cosmetic |
| 1.3 | business-side integration screens, document review queue, provider webhooks, guide editor | Phase 2 by design |
| 1.4 | old settings rows into the typed store; theme tokens applied to panels; partner share per payment | Phase 2 to 4 |
| 1.5 | `roles.perms_v1` backup column and `legacy-v1.ts` data | keep one release, then drop |
| 1.6 | owner's `update.ps1` lists squash-merged branches as "kept (not merged yet)" | harmless; the file lives only on the owner's PC |
| 1.6 | the remaining `backend-core/src` files hold real code, not forwarding | they move app by app in Phase 2 |

## How this sandbox works (for the builder)
No Prisma engine here: CI is the first real run of database tests (about 6 minutes). Front tests, lint, generators, checks and builds run locally.
