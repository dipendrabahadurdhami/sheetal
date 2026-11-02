import type { FastifyRequest } from "fastify";
import { requireUser, type SessionUser } from "@sheetal/backend-core/modules/auth/sessions";
import { forbidden } from "@sheetal/backend-core/lib/errors";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";

// Which business a request is for, and what the person may do in it.
// The business panel sends the workspace it has open in the "x-tenant-id" header; without it, the person's
// first business is used. A person can only act in a business they are a member of.

export type Member = SessionUser["memberships"][number];
export interface Workspace { user: SessionUser; member: Member; tenantId: string; can: (perm: string) => boolean }

export function workspaceOf(request: FastifyRequest): Workspace {
  const user = requireUser(request);
  const wanted = request.headers["x-tenant-id"];
  const member = typeof wanted === "string" && wanted
    ? user.memberships.find((m) => m.tenantId === wanted)
    : user.memberships[0];
  if (!member || member.status !== "active") throw forbidden("You are not a member of this business.");
  return { user, member, tenantId: member.tenantId, can: (perm) => hasPerm(member.role.perms, perm) };
}
