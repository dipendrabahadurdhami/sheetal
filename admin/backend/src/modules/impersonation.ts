// Support sessions in the admin API: "log in as the business" for Sheetal staff (ACCESS.md section 12).
// Where it fits: the admin panel's Businesses page (the "Open as support" button, P1-FE-4) calls these; the business API accepts the token they hand out
// (platform/src/support/hooks.ts). admin/backend/src/app.ts registers adminImpersonationRoutes under /v1.
// How it works:
//   POST /admin/businesses/:id/impersonate  { password, reason, minutes?, write?, writeReason? }  starts a session and answers the token ONCE
//   GET  /admin/support-sessions                                                                 my open sessions (never the token)
//   POST /admin/support-sessions/:id/end                                                         ends one (mine; the super admin may end any)
// The rules (fresh password, reason 10 to 300 characters, 15 minutes by default and 30 at most, read-only unless write mode with a second reason, the owners told,
// audit rows in both logs) are in platform/src/support/sessions.ts.
// Rules: only staff with platform.business.impersonate; the password check is rate-limited; the token is never logged.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { forbidden, notFound } from "@sheetal/platform/core/errors";
import { requireUser } from "@sheetal/backend-core/modules/auth/sessions";
import { buildStaffContext } from "@sheetal/platform/tenancy/context";
import { endSupportSession, startSupportSession } from "@sheetal/platform/support/sessions";

const StartBody = z.object({
  password: z.string().min(1).max(200),
  reason: z.string().max(400),
  minutes: z.number().int().min(1).max(60).optional(),
  write: z.boolean().optional(),
  writeReason: z.string().max(400).optional(),
}).strict();

export async function adminImpersonationRoutes(app: FastifyInstance) {
  const staffOf = (request: Parameters<typeof requireUser>[0]) =>
    buildStaffContext({ db: dbOf(app), user: requireUser(request), headers: request.headers, ip: request.ip, requestId: String(request.id), log: request.log });

  app.post<{ Params: { id: string } }>("/admin/businesses/:id/impersonate", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request) => {
    const staff = staffOf(request);
    const started = await startSupportSession({
      db: dbOf(app), staff, tenantId: request.params.id, input: StartBody.parse(request.body), secret: app.config.SECRETS_KEY, mailer: app.mailer,
    });
    return {
      message: started.session.readOnly ? `Opened ${started.session.business} (read-only) for ${started.session.minutes} minutes.` : `Opened ${started.session.business} (changes allowed) for ${started.session.minutes} minutes.`,
      data: { token: started.token, ...started.session },
    };
  });

  app.get("/admin/support-sessions", async (request) => {
    const staff = staffOf(request);
    staff.permissions.require("platform.business.impersonate", "Your staff role can't open a business as support.");
    const rows = await dbOf(app).impersonationSession.findMany({
      where: { staffId: staff.staff.id, endedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { startedAt: "desc" }, include: { tenant: { select: { id: true, name: true } } },
    });
    return { data: rows.map((s) => ({ id: s.id, business: s.tenant, reason: s.reason, readOnly: s.readOnly, startedAt: s.startedAt, expiresAt: s.expiresAt, requestCount: s.requestCount })) };
  });

  app.post<{ Params: { id: string } }>("/admin/support-sessions/:id/end", async (request) => {
    const staff = staffOf(request);
    const db = dbOf(app);
    const s = await db.impersonationSession.findUnique({ where: { id: request.params.id }, select: { id: true, staffId: true } });
    if (!s) throw notFound("Support session not found.");
    if (s.staffId !== staff.staff.id && staff.staff.role !== "super_admin") throw forbidden("That session is not yours.");
    await endSupportSession(db, { id: s.id, endedBy: staff.staff.id, by: "staff" });
    return { message: "Support session ended." };
  });
}
