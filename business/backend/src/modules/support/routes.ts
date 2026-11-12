// Messages to Sheetal (Business → Help → Message Sheetal): a business asks for help and reads the answers.
// Where it fits: LiveSupport.jsx in the business panel; Sheetal's team answers in Admin → Inbox → Support
// (admin/backend/src/modules/support.ts).
// How it works: a ticket (SUP-0007) holds the messages. Each message from the business tells Sheetal's staff (bell);
// a reply from staff tells the person who opened it (bell and email, sent from the admin side).
// Rules: any member can open a ticket; owners and people with settings.business see all of the business's tickets,
// others only their own. Staff notes never leave the admin side.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, notFound } from "@sheetal/backend-core/lib/errors";
import { STAFF_FOR, notifyStaff } from "@sheetal/backend-core/lib/notify";
import { workspaceOf, type Workspace } from "../access.js";

export const ticketNo = (seq: number) => `SUP-${String(seq).padStart(4, "0")}`;
const Text = z.string().trim().min(2, "Write your message.").max(5000);

export async function supportRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const seesAll = (ws: Workspace) => ws.member.role.perms.includes("*") || ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete");
  const scope = (ws: Workspace) => ({ tenantId: ws.tenantId, ...(seesAll(ws) ? {} : { userId: ws.user.id }) });
  const one = async (ws: Workspace, id: string) => {
    const t = await db().supportTicket.findFirst({ where: { ...scope(ws), id: id.slice(0, 40) } });
    if (!t) throw notFound("Message not found.");
    return t;
  };
  const tellStaff = (ws: Workspace, title: string, message: string) => notifyStaff(db(), STAFF_FOR.support, { type: "support", title, message: message.slice(0, 140), link: "/admin/inbox" });
  const audit = (ws: Workspace, request: FastifyRequest, action: string, target: string) => db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip: request.ip } });

  app.get("/support", async (request) => {
    const ws = workspaceOf(request);
    const rows = await db().supportTicket.findMany({ where: scope(ws), orderBy: { lastAt: "desc" }, take: 200, include: { messages: { where: { from: { not: "note" } }, orderBy: { createdAt: "desc" }, take: 1 } } });
    const names = new Map((await db().user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, userName: true } })).map((u) => [u.id, u.userName]));
    return {
      data: rows.map((r) => ({
        id: r.id, no: ticketNo(r.seq), subject: r.subject, status: r.status, lastAt: r.lastAt.toISOString(), by: names.get(r.userId) ?? "",
        last: r.messages[0]?.body.slice(0, 140) ?? "", unread: r.messages[0]?.from === "staff" && (!r.readByBusinessAt || r.readByBusinessAt < r.lastAt),
      })),
    };
  });

  app.post("/support", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({ subject: z.string().trim().min(3, "Say what it is about.").max(120), body: Text }).parse(request.body);
    const now = new Date();
    const t = await db().supportTicket.create({ data: { tenantId: ws.tenantId, userId: ws.user.id, subject: b.subject, lastAt: now, readByBusinessAt: now, messages: { create: { from: "business", userId: ws.user.id, body: b.body } } } });
    await tellStaff(ws, `New message from ${ws.member.tenant.name}: ${b.subject}`, b.body);
    await audit(ws, request, "support.opened", `${ticketNo(t.seq)} ${b.subject}`);
    return { message: `Sent to Sheetal (${ticketNo(t.seq)}). We usually answer within a working day.`, data: { id: t.id, no: ticketNo(t.seq) } };
  });

  app.get<{ Params: { id: string } }>("/support/:id", async (request) => {
    const ws = workspaceOf(request);
    const t = await one(ws, request.params.id);
    const msgs = await db().supportMessage.findMany({ where: { ticketId: t.id, from: { not: "note" } }, orderBy: { createdAt: "asc" } });
    const names = new Map((await db().user.findMany({ where: { id: { in: msgs.map((m) => m.userId).filter((x): x is string => !!x) } }, select: { id: true, userName: true } })).map((u) => [u.id, u.userName]));
    await db().supportTicket.update({ where: { id: t.id }, data: { readByBusinessAt: new Date() } });
    return {
      data: {
        id: t.id, no: ticketNo(t.seq), subject: t.subject, status: t.status, createdAt: t.createdAt.toISOString(),
        messages: msgs.map((m) => ({ id: m.id, from: m.from, by: m.from === "staff" ? `${m.userId ? names.get(m.userId) ?? "" : ""}, Sheetal` : m.userId ? names.get(m.userId) ?? "" : "", body: m.body, at: m.createdAt.toISOString() })),
      },
    };
  });

  app.post<{ Params: { id: string } }>("/support/:id/reply", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (request) => {
    const ws = workspaceOf(request);
    const t = await one(ws, request.params.id);
    const { body } = z.object({ body: Text }).parse(request.body);
    const now = new Date();
    await db().$transaction([
      db().supportMessage.create({ data: { ticketId: t.id, from: "business", userId: ws.user.id, body } }),
      db().supportTicket.update({ where: { id: t.id }, data: { status: "open", lastAt: now, readByBusinessAt: now } }),
    ]);
    await tellStaff(ws, `${ws.member.tenant.name} replied: ${t.subject}`, body);
    return { message: t.status === "closed" ? "Sent. The conversation is open again." : "Sent." };
  });

  app.post<{ Params: { id: string } }>("/support/:id/close", async (request) => {
    const ws = workspaceOf(request);
    const t = await one(ws, request.params.id);
    if (t.status === "closed") throw badRequest("It's already closed.");
    await db().supportTicket.update({ where: { id: t.id }, data: { status: "closed" } });
    await audit(ws, request, "support.closed", ticketNo(t.seq));
    return { message: "Closed. Write again any time to open it." };
  });
}
