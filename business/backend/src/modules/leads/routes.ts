import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { workspaceOf, type Workspace } from "../access.js";

// Enquiries from the website (contact agent or owner, site visits, requirements) land here as leads of the
// business that owns the listing. The Inbox shows each one as a conversation and the pipeline by stage.
// Replies go to the person by email, with the business's own email and phone to answer on.
// Who sees what: people who can assign leads see all of them; others see their own and unassigned ones.

const STAGES = ["new", "contacted", "viewing", "negotiating", "won", "lost"] as const;
const time = (d: Date) => d.toISOString();

export async function leadRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);

  function access(ws: Workspace) {
    if (!ws.can("leads.view") && !ws.can("messages.reply")) throw forbidden("Your role can't see leads.");
    const all = ws.can("leads.assign") || ws.member.role.key === "owner";
    const where: Prisma.LeadWhereInput = { tenantId: ws.tenantId, ...(all ? {} : { OR: [{ assigneeId: ws.user.id }, { assigneeId: null }] }) };
    return { all, where };
  }

  async function one(ws: Workspace, id: string) {
    const { where } = access(ws);
    const l = await db().lead.findFirst({ where: { AND: [where, { id }] } });
    if (!l) throw notFound("Lead not found.");
    return l;
  }

  app.get("/leads", async (request) => {
    const ws = workspaceOf(request);
    const { where } = access(ws);
    const q = z.object({ stage: z.enum(STAGES).optional(), take: z.coerce.number().int().min(1).max(500).default(200) }).parse(request.query);
    const leads = await db().lead.findMany({
      where: { ...where, ...(q.stage ? { status: q.stage } : {}) },
      include: { messages: { orderBy: { createdAt: "asc" } } }, orderBy: { lastAt: "desc" }, take: q.take,
    });
    const listings = await db().listing.findMany({ where: { id: { in: leads.map((l) => l.listingId).filter((x): x is number => x != null) } }, select: { id: true, code: true, title: true, price: true } });
    const byId = new Map(listings.map((l) => [l.id, l]));
    const names = new Map((await db().user.findMany({ where: { id: { in: leads.map((l) => l.assigneeId).filter((x): x is string => !!x) } }, select: { id: true, userName: true } })).map((u) => [u.id, u.userName]));
    return {
      data: leads.map((l) => {
        const listing = l.listingId ? byId.get(l.listingId) : undefined;
        const msgs = [["in", l.message || "(no message)", time(l.createdAt)], ...l.messages.map((m) => [m.direction, m.body, time(m.createdAt)])];
        return {
          id: l.id, channel: ((l.details as { channel?: string } | null)?.channel) ?? "website", kind: l.kind, name: l.name, email: l.email, phone: l.phone,
          stage: l.status, assignee: l.assigneeId, assigneeName: l.assigneeId ? names.get(l.assigneeId) ?? null : null,
          follow: l.followAt ? l.followAt.toISOString().slice(0, 10) : null, tags: l.tags,
          value: l.value != null ? Number(l.value) : listing?.price != null ? Number(listing.price) : null,
          listing: listing?.code ?? null, listingTitle: listing?.title ?? null, details: l.details,
          last: msgs[msgs.length - 1]![1], at: time(l.lastAt), unread: !l.readAt || l.readAt < l.lastAt ? 1 : 0, msgs,
        };
      }),
    };
  });

  app.patch<{ Params: { id: string } }>("/leads/:id", async (request) => {
    const ws = workspaceOf(request);
    const { all } = access(ws);
    const l = await one(ws, request.params.id);
    const b = z.object({
      stage: z.enum(STAGES).optional(),
      assignee: z.string().max(40).nullable().optional(),
      follow: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
      value: z.coerce.number().min(0).max(1e13).nullable().optional(),
      read: z.literal(true).optional(),
    }).parse(request.body);
    if (b.assignee !== undefined) {
      if (!all && b.assignee !== ws.user.id && b.assignee !== null) throw forbidden("Your role can't hand leads to others.");
      if (b.assignee && !(await db().membership.findFirst({ where: { tenantId: ws.tenantId, userId: b.assignee, status: "active" } }))) throw badRequest("Pick someone in your team.");
    }
    await db().lead.update({
      where: { id: l.id },
      data: {
        status: b.stage, assigneeId: b.assignee, tags: b.tags,
        followAt: b.follow === undefined ? undefined : b.follow ? new Date(`${b.follow}T09:00:00+05:45`) : null,
        value: b.value === undefined ? undefined : b.value == null ? null : BigInt(Math.round(b.value)),
        readAt: b.read ? new Date() : undefined,
      },
    });
    if (b.stage && b.stage !== l.status) await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "lead.stage", target: `${l.name}: ${b.stage}`, ip: request.ip } });
    return { message: b.read ? undefined : "Saved." };
  });

  app.post<{ Params: { id: string } }>("/leads/:id/reply", { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } }, async (request) => {
    const ws = workspaceOf(request);
    if (!ws.can("messages.reply")) throw forbidden("Your role can't reply to leads.");
    const l = await one(ws, request.params.id);
    const { text } = z.object({ text: z.string().trim().min(1, "Write a reply.").max(5000) }).parse(request.body);
    if (!l.email) throw badRequest(`${l.name} left a phone number only${l.phone ? ` (${l.phone})` : ""}. Call or WhatsApp them instead.`);
    const t = ws.member.tenant;
    const now = new Date();
    await db().$transaction([
      db().leadMessage.create({ data: { leadId: l.id, direction: "out", body: text, userId: ws.user.id } }),
      db().lead.update({ where: { id: l.id }, data: { lastAt: now, readAt: now, status: l.status === "new" ? "contacted" : undefined, assigneeId: l.assigneeId ?? ws.user.id } }),
    ]);
    await app.mailer.send({
      to: l.email, subject: `Re: your enquiry with ${t.name}`,
      text: `${text}\n\n— ${ws.user.userName}, ${t.name}${t.phone ? ` · ${t.phone}` : ""}${t.email ? `\nTo answer, write to ${t.email}.` : ""}\n\nYou wrote:\n${l.message}`,
    });
    return { message: `Sent to ${l.email}.` };
  });
}
