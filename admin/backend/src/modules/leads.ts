// Platform leads (Admin → Inbox → Leads): enquiries sent to Sheetal itself, that no business owns (contact,
// requirement, sell my property, partner sign-ups and other forms on the website with no business behind them).
// Where it fits: LiveLeads.jsx in the admin panel. The website makes these leads (website/backend engage routes) and
// tells staff; a lead passed to a business leaves this list and shows in that business's Inbox.
// How it works: the same stages as a business Inbox. Staff give a lead to a colleague (they get a notification),
// set a follow-up date, write notes only staff see, and reply by email from Sheetal's address. Passing a lead to a
// business moves it there (head office, unassigned, stage "new"), takes it off the requirement board, removes the
// staff notes, and tells the business (bell and email).
// Rules: staff with tenants.view work leads; only staff can be given a lead; the business must be active.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, notFound } from "@sheetal/backend-core/lib/errors";
import { leadPeople, notify } from "@sheetal/backend-core/lib/notify";
import { headOffice } from "@sheetal/backend-core/domain/branches";
import { PLATFORM_ROLES, hasPerm } from "@sheetal/backend-core/domain/permissions";
import { staffOf } from "./routes.js";

const STAGES = ["new", "contacted", "viewing", "negotiating", "won", "lost"] as const;
const KIND: Record<string, string> = { contact_agent: "Contact", contact_owner: "Message for the owner", site_visit: "Site visit", requirement: "Requirement", service: "Service request", form: "Online form", sell: "Sell my property", partner: "Partner sign-up" };
const PERM = "tenants.view";

export async function adminLeadRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const audit = (actorId: string, ip: string, action: string, target: string, tenantId?: string) => db().auditLog.create({ data: { actorId, ip, action, target, tenantId } });
  const one = async (id: string) => {
    const l = await db().lead.findFirst({ where: { id: id.slice(0, 40), tenantId: null } });
    if (!l) throw notFound("Lead not found. It may have been passed to a business.");
    return l;
  };

  app.get("/admin/leads", async (request) => {
    const s = staffOf(request, PERM);
    const q = z.object({ stage: z.enum(STAGES).optional(), mine: z.coerce.boolean().optional(), q: z.string().trim().max(80).optional(), take: z.coerce.number().int().min(1).max(2000).default(500) }).parse(request.query);
    const where: Prisma.LeadWhereInput = {
      tenantId: null, ...(q.stage ? { status: q.stage } : {}), ...(q.mine ? { assigneeId: s.user.id } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: "insensitive" } }, { message: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    const [rows, counts, staff] = await Promise.all([
      db().lead.findMany({ where, include: { messages: { orderBy: { createdAt: "asc" } } }, orderBy: { lastAt: "desc" }, take: q.take }),
      db().lead.groupBy({ by: ["status"], where: { tenantId: null }, _count: true }),
      db().user.findMany({ where: { platformRole: { not: null } }, select: { id: true, userName: true, platformRole: true } }),
    ]);
    const team = staff.filter((u) => u.platformRole && PLATFORM_ROLES[u.platformRole] && hasPerm(PLATFORM_ROLES[u.platformRole]!, PERM));
    const names = new Map(staff.map((u) => [u.id, u.userName]));
    const listings = await db().listing.findMany({ where: { id: { in: rows.map((l) => l.listingId).filter((x): x is number => x != null) } }, select: { id: true, code: true, title: true } });
    const L = new Map(listings.map((l) => [l.id, l]));
    return {
      data: {
        me: s.user.id,
        team: team.map((u) => ({ id: u.id, name: u.userName })),
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
        leads: rows.map((l) => {
          const listing = l.listingId ? L.get(l.listingId) : undefined;
          return {
            id: l.id, ref: `L-${String(l.ref).padStart(4, "0")}`, kind: l.kind, kindLabel: KIND[l.kind] ?? l.kind, name: l.name, email: l.email, phone: l.phone, message: l.message,
            details: l.details, stage: l.status, assignee: l.assigneeId, assigneeName: l.assigneeId ? names.get(l.assigneeId) ?? null : null,
            follow: l.followAt ? l.followAt.toISOString().slice(0, 10) : null, tags: l.tags, value: l.value != null ? Number(l.value) : null,
            listing: listing ? `${listing.code} · ${listing.title}` : null, onBoard: l.public, at: l.createdAt.toISOString(), last: l.lastAt.toISOString(),
            unread: !l.readAt || l.readAt < l.lastAt,
            msgs: l.messages.map((m) => ({ dir: m.direction, body: m.body, by: m.userId ? names.get(m.userId) ?? null : null, at: m.createdAt.toISOString() })),
          };
        }),
      },
    };
  });

  app.patch<{ Params: { id: string } }>("/admin/leads/:id", async (request) => {
    const s = staffOf(request, PERM);
    const l = await one(request.params.id);
    const b = z.object({
      stage: z.enum(STAGES).optional(),
      assignee: z.string().max(40).nullable().optional(),
      follow: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
      value: z.coerce.number().min(0).max(1e13).nullable().optional(),
      read: z.literal(true).optional(),
    }).parse(request.body);
    if (b.assignee) {
      const u = await db().user.findUnique({ where: { id: b.assignee }, select: { platformRole: true, userName: true } });
      if (!u?.platformRole || !PLATFORM_ROLES[u.platformRole] || !hasPerm(PLATFORM_ROLES[u.platformRole]!, PERM)) throw badRequest("Pick someone in Sheetal's staff who works leads.");
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
    if (b.assignee && b.assignee !== l.assigneeId && b.assignee !== s.user.id) {
      await notify(db(), [b.assignee], { type: "lead", title: `Lead for you: ${l.name}`, message: `${KIND[l.kind] ?? l.kind}${l.phone ? ` · ${l.phone}` : ""} · from ${s.user.userName}`, link: "/admin/leads" });
    }
    if (b.stage && b.stage !== l.status) await audit(s.user.id, request.ip, "lead.stage", `${l.name}: ${b.stage}`);
    return { message: b.read ? undefined : "Saved." };
  });

  // A note only staff see.
  app.post<{ Params: { id: string } }>("/admin/leads/:id/note", async (request) => {
    const s = staffOf(request, PERM);
    const l = await one(request.params.id);
    const { text } = z.object({ text: z.string().trim().min(1, "Write a note.").max(2000) }).parse(request.body);
    await db().leadMessage.create({ data: { leadId: l.id, direction: "note", body: text, userId: s.user.id } });
    return { message: "Note saved." };
  });

  app.post<{ Params: { id: string } }>("/admin/leads/:id/reply", { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } }, async (request) => {
    const s = staffOf(request, PERM);
    const l = await one(request.params.id);
    const { text } = z.object({ text: z.string().trim().min(1, "Write a reply.").max(5000) }).parse(request.body);
    if (!l.email) throw badRequest(`${l.name} left a phone number only${l.phone ? ` (${l.phone})` : ""}. Call or WhatsApp them instead.`);
    const now = new Date();
    await db().$transaction([
      db().leadMessage.create({ data: { leadId: l.id, direction: "out", body: text, userId: s.user.id } }),
      db().lead.update({ where: { id: l.id }, data: { lastAt: now, readAt: now, status: l.status === "new" ? "contacted" : undefined, assigneeId: l.assigneeId ?? s.user.id } }),
    ]);
    await app.mailer.send({ to: l.email, subject: "Re: your message to Sheetal Property", text: `${text}\n\n— ${s.user.userName}, Sheetal Property\n\nYou wrote:\n${l.message}` });
    return { message: `Sent to ${l.email}.` };
  });

  // Moves the lead to a business's Inbox.
  app.post<{ Params: { id: string } }>("/admin/leads/:id/pass", async (request) => {
    const s = staffOf(request, PERM);
    const l = await one(request.params.id);
    const b = z.object({ tenantId: z.string().max(40), note: z.string().trim().max(1000).optional() }).parse(request.body);
    const t = await db().tenant.findUnique({ where: { id: b.tenantId }, select: { id: true, name: true, email: true, status: true } });
    if (!t) throw notFound("Business not found.");
    if (!["active", "trial", "past_due"].includes(t.status)) throw badRequest(`${t.name} isn't active. Pick another business.`);
    const branchId = await headOffice(db(), t.id);
    const details = { ...((l.details ?? {}) as Record<string, unknown>), passedBy: "Sheetal", passedAt: new Date().toISOString(), ...(b.note ? { sheetalNote: b.note } : {}) };
    await db().$transaction([
      db().leadMessage.deleteMany({ where: { leadId: l.id, direction: "note" } }),
      db().lead.update({ where: { id: l.id }, data: { tenantId: t.id, branchId, assigneeId: null, status: "new", readAt: null, followAt: null, public: false, lastAt: new Date(), tags: [...new Set([...l.tags, "From Sheetal"])].slice(0, 10), details: details as Prisma.InputJsonValue } }),
    ]);
    await audit(s.user.id, request.ip, "lead.passed", `${l.name} → ${t.name}`, t.id);
    await notify(db(), await leadPeople(db(), t.id, branchId), { tenantId: t.id, type: "lead", title: `Sheetal sent you a lead: ${l.name}`, message: (b.note || l.message).slice(0, 140), link: "/business/inbox" });
    if (t.email) {
      await app.mailer.send({
        to: t.email, subject: `A lead from Sheetal Property: ${l.name}`,
        text: [`Sheetal Property passed you a lead. It is in your Inbox now.`, "", `Name: ${l.name}`, l.phone ? `Phone: ${l.phone}` : "", l.email ? `Email: ${l.email}` : "", l.message ? `\n${l.message}` : "", b.note ? `\nFrom Sheetal: ${b.note}` : "", "", "Reply from your Inbox in Sheetal Business."].filter((x) => x !== "").join("\n"),
      });
    }
    return { message: `Passed to ${t.name}. They have been told.` };
  });
}
