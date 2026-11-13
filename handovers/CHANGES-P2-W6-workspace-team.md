# CHANGES P2-W6 Workspace, part 2a: the team (members, roles, invites, profile, branding, Pro cover)

- `business/backend/src/modules/team/routes.ts` → `apps/workspace/backend/` (`team.repository.ts`, `team.service.ts`, `team.controller.ts`, registered by
  `workspaceRoutes`). The old file is a shim: `teamRoutes` registers nothing; `app.ts` no longer registers it.
- Same routes, answers, messages, status codes and audit strings. Every change now writes its audit line and its event in ONE transaction; an invitation
  email is sent only after its row is saved (before, a failed email could leave an invitation with no audit line).
- New audit lines: `team.invite_resent` (a resend had none) and `billing.uncovered` (stopping the Pro cover had none). They show in the Team activity list.
- Events (manifest): `workspace.business.created|covered`, `workspace.profile.saved`, `workspace.branding.saved`, `workspace.invite.sent|revoked`,
  `workspace.member.joined|updated|removed`, `workspace.role.created|updated|deleted`.
- Team routes now use the kernel context. So a Sheetal support session can open the Team page (before: refused as "not signed in"); a read-only session is
  refused on every change, and even a write-mode session never invites, changes or removes people or roles (ACCESS.md 12 deny list).
- The four routes with no business yet (`GET/POST /workspaces`, `GET /invites/preview`, `POST /invites/accept`) take the signed-in person as before.
- No migration: team rows have no version column or soft delete (a member is removed for real, as before).
- Tests: old tests unchanged (`team.test.ts`, `tenancy.test.ts`, `branches.test.ts`, `demo.test.ts`); new `business/backend/test/team-kernel.test.ts`.
  `packages/config/src/no-old-names.test.js`: the 3 look-alike comments of the old team file are gone with the move, so its pinned entry is removed.
