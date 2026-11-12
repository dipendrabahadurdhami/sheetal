// How the business API accepts a support session token (ACCESS.md section 12): who the request is, what it may do, and what is recorded.
// Where it fits: business/backend/src/app.ts calls registerSupportSessions(app) right after the base app, so this hook runs after the normal sign-in hook.
// How it works: a request with `Authorization: Bearer sup1.…` is looked up with resolveSupportSession(). If the session is open:
//   - `request.support` is set (session, staff member);
//   - `request.user` becomes the staff member with ONE membership: the business of the session, with the owner's permissions minus the fixed deny list, every
//     branch. So workspaceOf() and the old routes work unchanged (and businessContextOf() builds a real support context for the kernel routes);
//   - in a read-only session every request that is not a plain read is refused with 403 impersonation_read_only (except ending the session);
//   - the request is counted (requestCount), and every write is written to the audit log ("impersonation.write", with the staff id and the reason), every open of a
//     private file or document as "impersonation.opened_file".
// A session that ended, ran out, or whose staff member left answers 401 "This support session has ended.".
// Rules: a support token only ever works on the business of its session (x-tenant-id for another business finds no membership). The deny list is the one in
// tenancy/context.ts. Nothing here runs for a request without a support token.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError, unauthorized } from "../core/errors.js";
import type { Db } from "../db/client.js";
import { isSupportToken } from "../auth/support-token.js";
import type { SessionUser } from "../auth/sessions.js";
import { deniedInSupport } from "../tenancy/context.js";
import { PERMISSION_CATALOG } from "../tenancy/permissions.generated.js";
import { countRequest, resolveSupportSession, type SupportSessionView } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest { support: SupportSessionView | null }
}

/** The grants of the support role: every business permission at scope "all", except the deny list. (Old names work through the alias layer.) */
export const SUPPORT_ROLE_PERMS: string[] = PERMISSION_CATALOG.filter((p) => p.app !== "platform" && !deniedInSupport(p.id)).map((p) => `${p.id}:all`);

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Routes a read-only session may still call: the banner's "End session". */
const ALWAYS_OK = /\/support\/(session|end)$/;
/** A private file or a document: its opening is recorded. */
const FILE_ROUTE = /(receipt|document|private|kyc|attachment|\/files?\/)/i;

/**
 * The staff member as a signed-in user of the session's business. Typed as SessionUser: the fields a route never reads are filled with neutral values.
 * (The role id "support" matches no row on purpose: nothing can look it up or edit it.)
 */
export function supportUser(s: SupportSessionView, tenant: unknown, staffRow: unknown): SessionUser {
  const role = { id: "support", tenantId: s.tenantId, key: "support", name: "Sheetal support", perms: SUPPORT_ROLE_PERMS, permsV1: [], system: true };
  const membership = {
    id: `support:${s.id}`, userId: s.staffId, tenantId: s.tenantId, roleId: "support", scopes: "all", allBranches: true, status: "active",
    createdAt: s.startedAt, tenant, role, branches: [],
  };
  return { ...(staffRow as object), memberships: [membership] } as unknown as SessionUser;
}

export function registerSupportSessions(app: FastifyInstance & { db?: Db; config: { SECRETS_KEY?: string } }) {
  app.decorateRequest("support", null);

  app.addHook("preHandler", async (request) => {
    const header = request.headers.authorization;
    if (!app.db || !header?.startsWith("Bearer ")) return;
    const token = header.slice(7).trim();
    if (!isSupportToken(token)) return;

    const found = await resolveSupportSession(app.db, app.config.SECRETS_KEY, token);
    if (!found) throw unauthorized("This support session has ended.");
    if (found.readOnly && !READS.has(request.method) && !ALWAYS_OK.test(request.url.split("?")[0] ?? "")) {
      throw new AppError(403, "impersonation_read_only", "This is a read-only support session. Changes are not allowed.");
    }
    const [tenant, staffRow] = await Promise.all([
      app.db.tenant.findUnique({ where: { id: found.tenantId }, include: { plan: true } }),
      app.db.user.findUnique({ where: { id: found.staffId } }),
    ]);
    if (!tenant || !staffRow) throw unauthorized("This support session has ended.");
    request.support = found;
    request.user = supportUser(found, tenant, staffRow);
    request.sessionHash = null;
    countRequest(app.db, found.id);
  });

  // The trail: every write, and every opening of a private file, while a support session is in use.
  // Written in onSend (before the answer leaves), not after it: when the caller has the answer, the audit row exists. (It used to be written after the
  // response, so a reader that looked straight away could miss it; the CI run on main caught that twice.)
  app.addHook("onSend", async (request: FastifyRequest, reply, payload: unknown) => {
    const s = request.support;
    if (!s || !app.db || reply.statusCode >= 400) return payload;
    const route = request.routeOptions?.url ?? request.url.split("?")[0] ?? "";
    const write = !READS.has(request.method);
    const file = !write && FILE_ROUTE.test(route);
    if (!write && !file) return payload;
    if (ALWAYS_OK.test(route)) return payload;
    await app.db.auditLog.create({
      data: {
        tenantId: s.tenantId, actorId: s.staffId, action: write ? "impersonation.write" : "impersonation.opened_file", target: `${request.method} ${route}`, ip: request.ip,
        meta: { impersonatedBy: s.staffId, reason: s.reason, sessionId: s.id, status: reply.statusCode },
      },
    }).catch((err: unknown) => request.log.warn({ err }, "support audit row failed"));
    return payload;
  });
}
