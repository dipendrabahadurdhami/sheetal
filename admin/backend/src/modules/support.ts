// Admin → Inbox → Support: messages from businesses to Sheetal, with replies, staff-only notes and who handles each.
// Where it fits: LiveSupport.jsx in the admin panel; businesses write from Business → Help
// (business/backend/src/modules/support/routes.ts).
// How it works: open = waiting for Sheetal, waiting = Sheetal answered, closed. A staff reply sets "waiting" and tells
// the person who opened it (bell in their business, and an email). Giving a ticket to a colleague tells them.
// Rules: staff with tenants.view; only staff who can see the inbox can be given a ticket; notes are never shown to
// the business.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, notFound } from "@sheetal/platform/core/errors";
import { notify } from "@sheetal/platform/notify/index";
import { PLATFORM_ROLES, hasPerm } from "@sheetal/backend-core/domain/permissions";
import { staffOf } from "./routes.js";

const PERM = "platform.business.read";
const ticketNo = (seq: number) => `SUP-${String(seq).padStart(4, "0")}`;
const Text = z.string().trim().min(1, "Write something.").max(5000);

export async function adminSupportRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const one = async (id: string) => {
    const t = await db().supportTicket.findUnique({ where: { id: id.slice(0, 40) } });
    if (!t) throw notFound("Message not found.");
    return t;
  };
  const audit = (actorId: string, ip: string, action: string, target: string, tenantId?: string) => db().auditLog.create({ data: { actorId, ip, action, target, tenantId } });
  const isInboxStaff = (role?: string | null) => !!role && !!PLATFORM_ROLES[role] && hasPerm(PLATFORM_ROLES[role]!, PERM);

  app.get("/admin/support", async (request) => {
    const s = staffOf(request, PERM);
    const q = z.object({ status: z.enum(["open", "waiting", "closed", "all"]).default("all"), mine: z.coerce.boolean().optional(), tenantId: z.string().max(40).optional() }).parse(request.query);
    const where: Prisma.SupportTicketWhereInput = { ...(q.status !== "all" ? { status: q.status } : {}), ...(q.mine ? { assigneeId: s.user.id } : {}), ...(q.tenantId ? { tenantId: q.tenantId } : {}) };
    const [rows, counts, staff] = await Promise.all([
      db().supportTicket.findMany({ where, orderBy: { lastAt: "desc" }, take: 500, include: { messages: { where: { from: { not: "note" } }, orderBy: { createdAt: "desc" }, take: 1 } } }),
      db().supportTicket.groupBy({ by: ["status"], _count: true }),
      db().user.findMany({ where: { platformRole: { not: null } }, select: { id: true, userName: true, platformRole: true } }),
    ]);
    const [tenants, people] = await Promise.all([
      db().tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } }),
      db().user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, userName: true, email: true } }),
    ]);
    const T = new Map(tenants.map((x) => [x.id, x.name])), P = new Map(people.map((x) => [x.id, x])), S = new Map(staff.map((x) => [x.id, x.userName]));
    return {
      data: {
        me: s.user.id,
        team: staff.filter((u) => isInboxStaff(u.platformRole)).map((u) => ({ id: u.id, name: u.userName })),
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
        tickets: rows.map((r) => ({
          id: r.id, no: ticketNo(r.seq), subject: r.subject, status: r.status, tenantId: r.tenantId, tenant: T.get(r.tenantId) ?? "", by: P.get(r.userId)?.userName ?? "",
          assignee: r.assigneeId, assigneeName: r.assigneeId ? S.get(r.assigneeId) ?? null : null, lastAt: r.lastAt.toISOString(),
          last: r.messages[0]?.body.slice(0, 140) ?? "", unread: r.messages[0]?.from === "business" && (!r.readByStaffAt || r.readByStaffAt < r.lastAt),
        })),
      },
    };
  });

  app.get<{ Params: { id: string } }>("/admin/support/:id", async (request) => {
    staffOf(request, PERM);
    const t = await one(request.params.id);
    const [msgs, tenant, person] = await Promise.all([
      db().supportMessage.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: "asc" } }),
      db().tenant.findUnique({ where: { id: t.tenantId }, select: { name: true, type: true, planId: true, status: true } }),
      db().user.findUnique({ where: { id: t.userId }, select: { userName: true, email: true, phone: true } }),
    ]);
    const names = new Map((await db().user.findMany({ where: { id: { in: msgs.map((m) => m.userId).filter((x): x is string => !!x) } }, select: { id: true, userName: true } })).map((u) => [u.id, u.userName]));
    await db().supportTicket.update({ where: { id: t.id }, data: { readByStaffAt: new Date() } });
    return {
      data: {
        id: t.id, no: ticketNo(t.seq), subject: t.subject, status: t.status, tenantId: t.tenantId, tenant, person, assignee: t.assigneeId, createdAt: t.createdAt.toISOString(),
        messages: msgs.map((m) => ({ id: m.id, from: m.from, by: m.userId ? names.get(m.userId) ?? "" : "", body: m.body, at: m.createdAt.toISOString() })),
      },
    };
  });

  app.post<{ Params: { id: string } }>("/admin/support/:id/reply", { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } }, async (request) => {
    const s = staffOf(request, PERM);
    const t = await one(request.params.id);
    const { body } = z.object({ body: Text }).parse(request.body);
    const now = new Date();
    await db().$transaction([
      db().supportMessage.create({ data: { ticketId: t.id, from: "staff", userId: s.user.id, body } }),
      db().supportTicket.update({ where: { id: t.id }, data: { status: "waiting", lastAt: now, readByStaffAt: now, assigneeId: t.assigneeId ?? s.user.id } }),
    ]);
    const person = await db().user.findUnique({ where: { id: t.userId }, select: { id: true, email: true, userName: true } });
    await notify(db(), [t.userId], { tenantId: t.tenantId, type: "support", title: `Sheetal answered: ${t.subject}`, message: body.slice(0, 140), link: "/business/help" });
    if (person?.email) {
      const site = app.config.SITE_URL.replace(/\/$/, "");
      await app.mailer.send({ to: person.email, subject: `Re: ${t.subject} (${ticketNo(t.seq)})`, text: `Namaste ${person.userName},\n\n${body}\n\n— ${s.user.userName}, Sheetal Property\n\nTo answer, open Business → Help:\n${site}/business/help` });
    }
    await audit(s.user.id, request.ip, "support.replied", ticketNo(t.seq), t.tenantId);
    return { message: "Sent. They have been told." };
  });

  app.post<{ Params: { id: string } }>("/admin/support/:id/note", async (request) => {
    const s = staffOf(request, PERM);
    const t = await one(request.params.id);
    const { body } = z.object({ body: Text }).parse(request.body);
    await db().supportMessage.create({ data: { ticketId: t.id, from: "note", userId: s.user.id, body } });
    return { message: "Note saved." };
  });

  app.patch<{ Params: { id: string } }>("/admin/support/:id", async (request) => {
    const s = staffOf(request, PERM);
    const t = await one(request.params.id);
    const b = z.object({ assignee: z.string().max(40).nullable().optional(), status: z.enum(["open", "waiting", "closed"]).optional() }).parse(request.body);
    if (b.assignee) {
      const u = await db().user.findUnique({ where: { id: b.assignee }, select: { platformRole: true } });
      if (!isInboxStaff(u?.platformRole)) throw badRequest("Pick someone in Sheetal's staff who works the inbox.");
    }
    await db().supportTicket.update({ where: { id: t.id }, data: { assigneeId: b.assignee, status: b.status } });
    if (b.assignee && b.assignee !== t.assigneeId && b.assignee !== s.user.id) await notify(db(), [b.assignee], { type: "support", title: `Support message for you: ${t.subject}`, message: `${ticketNo(t.seq)} · from ${s.user.userName}`, link: "/admin/inbox" });
    if (b.status && b.status !== t.status) await audit(s.user.id, request.ip, `support.${b.status}`, ticketNo(t.seq), t.tenantId);
    return { message: "Saved." };
  });
}
