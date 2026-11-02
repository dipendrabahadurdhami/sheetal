import type { FastifyInstance } from "fastify";
import type { Mailbox, Prisma } from "@prisma/client";
import { createId } from "./id.js";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { AppError, badRequest, conflict, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { newToken, safeEqual } from "@sheetal/backend-core/lib/secrets";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { mailQuotaBytes } from "@sheetal/backend-core/domain/plans";
import { workspaceOf, type Workspace } from "../access.js";
import { checkRecords, isVerified, newDkimKeys, recordsFor, systemResolver, type Resolver } from "./dns.js";

// Business email: own domains, a mailbox per team member or shared address, folders, sending and receiving.
// - Everyone uses their own mailbox and the shared ones they were given.
// - "settings.business" (owners, managers) adds domains and mailboxes; "team.manage" can open every team mailbox.
// - Mail between Sheetal mailboxes is delivered at once; mail to anyone else is queued for the mail server.
// - Storage counts every message and attachment of the business against its plan (1 GB on paid plans).

const FOLDERS = ["inbox", "sent", "drafts", "archive", "spam", "trash"] as const;
const MAX_ATTACH = 20 * 1024 * 1024; // all attachments of one email
const PAGE = 50;

const address = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
const addresses = z.array(address).max(100).default([]);
const domainName = z.string().trim().toLowerCase().regex(/^(?=.{3,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,63}$/, "Enter a domain like yourbusiness.com.");
const localPart = z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/, "Use letters, numbers, dots, dashes or underscores.");
const attachment = z.object({ filename: z.string().trim().min(1).max(200), contentType: z.string().max(120).default("application/octet-stream"), data: z.string().max(30_000_000) });

/** Removes scripts, frames, inline handlers and javascript: links from mail HTML. */
export const cleanHtml = (html?: string | null) => html
  ? html.replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|meta|link|base)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
  : null;
const snippetOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 160);
const sizeOf = (m: { subject: string; text: string; html?: string | null }, attachBytes = 0) =>
  Buffer.byteLength(m.subject) + Buffer.byteLength(m.text) + Buffer.byteLength(m.html ?? "") + attachBytes;

/** An attachment from the request (base64) as stored: bytes plus their size. */
const fileOf = (a: { filename: string; contentType: string; data: string }) => { const data = Buffer.from(a.data, "base64"); return { filename: a.filename, contentType: a.contentType, data, size: data.length }; };

export interface MailOptions { resolver?: Resolver }

export async function mailRoutes(app: FastifyInstance, opts: MailOptions) {
  const resolver = opts.resolver ?? systemResolver;
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const mailHost = app.config.MAIL_HOST;

  const used = async (tenantId: string) => (await dbOf(app).mailMessage.aggregate({ where: { tenantId }, _sum: { size: true } }))._sum.size ?? 0;
  const quotaOf = (ws: Workspace) => mailQuotaBytes(ws.member.tenant.plan);
  const paidOnly = (ws: Workspace) => { if (!quotaOf(ws)) throw new AppError(402, "upgrade_needed", "Team email is part of the Business and Pro plans."); };
  const manage = (ws: Workspace) => { paidOnly(ws); if (!ws.can("settings.business")) throw forbidden("Only owners and managers can set up email."); };

  /** Mailboxes this person may open in this business. */
  const visibleWhere = (ws: Workspace): Prisma.MailboxWhereInput => ws.can("team.manage")
    ? { tenantId: ws.tenantId }
    : { tenantId: ws.tenantId, OR: [{ userId: ws.user.id }, { access: { some: { userId: ws.user.id } } }] };

  async function mailboxFor(ws: Workspace, id: string): Promise<Mailbox> {
    const box = await dbOf(app).mailbox.findFirst({ where: { AND: [{ id }, visibleWhere(ws)] } });
    if (!box) throw notFound("Mailbox not found.");
    return box;
  }
  async function messageFor(ws: Workspace, id: string) {
    const m = await dbOf(app).mailMessage.findFirst({ where: { id, mailbox: visibleWhere(ws) }, include: { attachments: { select: { id: true, filename: true, contentType: true, size: true } } } });
    if (!m) throw notFound("Email not found.");
    return m;
  }

  const domainJson = (d: { id: string; name: string; verified: boolean; verifyToken: string; dkimSelector: string; dkimPublicKey: string; checks: unknown; checkedAt: Date | null }) => {
    const checks = (d.checks ?? {}) as Record<string, string>;
    return { id: d.id, name: d.name, verified: d.verified, checkedAt: d.checkedAt, records: recordsFor(d.name, d, mailHost).map((r) => ({ ...r, status: checks[r.id] ?? "unchecked" })) };
  };

  // ───── Overview: domains, the mailboxes I can open, storage ─────
  app.get("/mail", async (request) => {
    const ws = workspaceOf(request);
    const db = dbOf(app);
    const [domains, boxes, usedBytes] = await Promise.all([
      db.mailDomain.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "asc" } }),
      db.mailbox.findMany({ where: visibleWhere(ws), include: { access: { select: { userId: true } } }, orderBy: [{ kind: "asc" }, { address: "asc" }] }),
      used(ws.tenantId),
    ]);
    const unread = await db.mailMessage.groupBy({ by: ["mailboxId"], where: { mailboxId: { in: boxes.map((b) => b.id) }, folder: "inbox", seen: false }, _count: true });
    const unreadOf = new Map(unread.map((u) => [u.mailboxId, u._count]));
    return {
      data: {
        paid: quotaOf(ws) > 0,
        canManage: ws.can("settings.business"),
        canSeeAll: ws.can("team.manage"),
        quota: { used: usedBytes, limit: quotaOf(ws) },
        domains: domains.map(domainJson),
        mailboxes: boxes.map((b) => ({ id: b.id, address: b.address, name: b.name, kind: b.kind, userId: b.userId, active: b.active, mine: b.userId === ws.user.id, accessUserIds: b.access.map((a) => a.userId), unread: unreadOf.get(b.id) ?? 0 })),
      },
    };
  });

  // ───── Domains ─────
  app.post("/mail/domains", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const { name } = z.object({ name: domainName }).parse(request.body);
    if (await dbOf(app).mailDomain.findUnique({ where: { name } })) throw conflict("This domain is already connected to Sheetal.");
    const keys = newDkimKeys();
    const d = await dbOf(app).mailDomain.create({ data: { tenantId: ws.tenantId, name, verifyToken: newToken(18), dkimPublicKey: keys.publicKey, dkimPrivateKey: vault.seal(keys.privateKey) } });
    return { status: 200, message: "Domain added. Add the DNS records, then check them.", data: domainJson(d) };
  });

  app.post<{ Params: { id: string } }>("/mail/domains/:id/check", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const d = await dbOf(app).mailDomain.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId } });
    if (!d) throw notFound("Domain not found.");
    const checks = await checkRecords(resolver, d.name, d, mailHost);
    const saved = await dbOf(app).mailDomain.update({ where: { id: d.id }, data: { checks, checkedAt: new Date(), verified: isVerified(checks) } });
    return { status: 200, message: saved.verified ? "All set: you can create mailboxes." : "Some records are not there yet. DNS changes can take up to an hour.", data: domainJson(saved) };
  });

  app.delete<{ Params: { id: string } }>("/mail/domains/:id", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const d = await dbOf(app).mailDomain.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId }, include: { _count: { select: { mailboxes: true } } } });
    if (!d) throw notFound("Domain not found.");
    if (d._count.mailboxes) throw conflict("Delete this domain's mailboxes first.");
    await dbOf(app).mailDomain.delete({ where: { id: d.id } });
    return { status: 200, message: "Domain removed." };
  });

  // ───── Mailboxes ─────
  // Team members to choose from when giving someone a mailbox.
  app.get("/mail/team", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const rows = await dbOf(app).membership.findMany({ where: { tenantId: ws.tenantId, status: "active" }, include: { user: { select: { id: true, userName: true, email: true } }, role: { select: { key: true, name: true } } }, orderBy: { createdAt: "asc" } });
    return { data: rows.map((m) => ({ userId: m.user.id, name: m.user.userName, email: m.user.email, role: m.role.name ?? m.role.key })) };
  });

  const memberIds = async (tenantId: string, ids: string[]) => {
    if (!ids.length) return;
    const n = await dbOf(app).membership.count({ where: { tenantId, userId: { in: ids }, status: "active" } });
    if (n !== new Set(ids).size) throw badRequest("Mailboxes can only be given to people in your team.");
  };

  app.post("/mail/mailboxes", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const b = z.object({
      domainId: z.string().min(1), local: localPart, name: z.string().trim().min(1).max(80),
      kind: z.enum(["person", "shared"]).default("person"), userId: z.string().optional(), accessUserIds: z.array(z.string()).max(50).default([]),
    }).parse(request.body);
    const d = await dbOf(app).mailDomain.findFirst({ where: { id: b.domainId, tenantId: ws.tenantId } });
    if (!d) throw notFound("Domain not found.");
    if (!d.verified) throw badRequest("Check the domain's DNS records first; mailboxes open once they are all green.");
    if (b.kind === "person" && !b.userId) throw badRequest("Choose the team member this mailbox is for.");
    await memberIds(ws.tenantId, [...(b.userId ? [b.userId] : []), ...b.accessUserIds]);
    const addressFull = `${b.local}@${d.name}`;
    if (await dbOf(app).mailbox.findUnique({ where: { address: addressFull } })) throw conflict(`${addressFull} already exists.`);
    const box = await dbOf(app).mailbox.create({
      data: { tenantId: ws.tenantId, domainId: d.id, address: addressFull, name: b.name, kind: b.kind, userId: b.kind === "person" ? b.userId : null,
        access: { create: b.accessUserIds.map((userId) => ({ userId })) } },
    });
    return { status: 200, message: `${box.address} is ready.`, data: { id: box.id, address: box.address } };
  });

  app.patch<{ Params: { id: string } }>("/mail/mailboxes/:id", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const b = z.object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional(), accessUserIds: z.array(z.string()).max(50).optional() }).parse(request.body);
    const box = await dbOf(app).mailbox.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId } });
    if (!box) throw notFound("Mailbox not found.");
    if (b.accessUserIds) await memberIds(ws.tenantId, b.accessUserIds);
    await dbOf(app).mailbox.update({
      where: { id: box.id },
      data: { name: b.name, active: b.active, ...(b.accessUserIds ? { access: { deleteMany: {}, create: b.accessUserIds.map((userId) => ({ userId })) } } : {}) },
    });
    return { status: 200, message: "Mailbox updated." };
  });

  app.delete<{ Params: { id: string } }>("/mail/mailboxes/:id", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const { confirm } = z.object({ confirm: z.string() }).parse(request.body ?? {});
    const box = await dbOf(app).mailbox.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId } });
    if (!box) throw notFound("Mailbox not found.");
    if (confirm.trim().toLowerCase() !== box.address) throw badRequest("Type the full address to confirm. All its mail will be deleted.");
    await dbOf(app).mailbox.delete({ where: { id: box.id } });
    return { status: 200, message: `${box.address} and its mail were deleted.` };
  });

  // ───── Reading ─────
  app.get<{ Params: { id: string } }>("/mail/mailboxes/:id/messages", async (request) => {
    const ws = workspaceOf(request);
    const box = await mailboxFor(ws, request.params.id);
    const q = z.object({ folder: z.enum(FOLDERS).default("inbox"), q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(1000).default(1) }).parse(request.query);
    const where: Prisma.MailMessageWhereInput = {
      mailboxId: box.id, folder: q.folder,
      ...(q.q ? { OR: [{ subject: { contains: q.q, mode: "insensitive" } }, { fromAddress: { contains: q.q, mode: "insensitive" } }, { fromName: { contains: q.q, mode: "insensitive" } }, { text: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    const db = dbOf(app);
    const [total, rows, unread] = await Promise.all([
      db.mailMessage.count({ where }),
      db.mailMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * PAGE, take: PAGE,
        select: { id: true, threadId: true, fromAddress: true, fromName: true, to: true, subject: true, snippet: true, seen: true, starred: true, status: true, createdAt: true, sentAt: true, _count: { select: { attachments: true } } } }),
      db.mailMessage.groupBy({ by: ["folder"], where: { mailboxId: box.id, seen: false }, _count: true }),
    ]);
    return {
      data: rows.map(({ _count, ...m }) => ({ ...m, attachments: _count.attachments })),
      meta: { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / PAGE)), per_page: PAGE },
      unread: Object.fromEntries(unread.map((u) => [u.folder, u._count])),
    };
  });

  app.get<{ Params: { id: string } }>("/mail/messages/:id", async (request) => {
    const ws = workspaceOf(request);
    const m = await messageFor(ws, request.params.id);
    if (!m.seen) await dbOf(app).mailMessage.update({ where: { id: m.id }, data: { seen: true } });
    const thread = await dbOf(app).mailMessage.findMany({ where: { threadId: m.threadId, mailboxId: m.mailboxId, folder: { not: "trash" } }, orderBy: { createdAt: "asc" }, select: { id: true, fromAddress: true, fromName: true, subject: true, snippet: true, createdAt: true } });
    return { data: { ...m, seen: true, thread } };
  });

  app.get<{ Params: { id: string } }>("/mail/attachments/:id", async (request, reply) => {
    const ws = workspaceOf(request);
    const a = await dbOf(app).mailAttachment.findFirst({ where: { id: request.params.id, message: { mailbox: visibleWhere(ws) } } });
    if (!a) throw notFound("Attachment not found.");
    return reply.header("content-type", a.contentType).header("content-disposition", `attachment; filename="${a.filename.replace(/["\r\n]/g, "")}"`).send(Buffer.from(a.data));
  });

  app.patch<{ Params: { id: string } }>("/mail/messages/:id", async (request) => {
    const ws = workspaceOf(request);
    const m = await messageFor(ws, request.params.id);
    const b = z.object({ folder: z.enum(FOLDERS).optional(), seen: z.boolean().optional(), starred: z.boolean().optional() }).parse(request.body);
    if (b.folder === "drafts" || (m.folder === "drafts" && b.folder && b.folder !== "trash")) throw badRequest("Drafts can only be sent or deleted.");
    await dbOf(app).mailMessage.update({ where: { id: m.id }, data: b });
    return { status: 200, message: b.folder ? `Moved to ${b.folder}.` : "Saved." };
  });

  app.delete<{ Params: { id: string } }>("/mail/messages/:id", async (request) => {
    const ws = workspaceOf(request);
    const m = await messageFor(ws, request.params.id);
    if (m.folder === "trash" || m.folder === "drafts") {
      await dbOf(app).mailMessage.delete({ where: { id: m.id } });
      return { status: 200, message: "Deleted for good." };
    }
    await dbOf(app).mailMessage.update({ where: { id: m.id }, data: { folder: "trash" } });
    return { status: 200, message: "Moved to Trash." };
  });

  // ───── Writing ─────
  const compose = z.object({
    mailboxId: z.string().min(1),
    to: addresses, cc: addresses, bcc: addresses,
    subject: z.string().trim().max(300).default(""),
    text: z.string().max(200_000).default(""),
    html: z.string().max(500_000).optional(),
    replyTo: z.string().optional(), // id of the message being answered
    draftId: z.string().optional(),
    attachments: z.array(attachment).max(20).default([]),
  });

  async function senderBox(ws: Workspace, id: string) {
    paidOnly(ws);
    const box = await mailboxFor(ws, id);
    if (!box.active) throw badRequest("This mailbox is switched off.");
    const domain = await dbOf(app).mailDomain.findUnique({ where: { id: box.domainId } });
    if (!domain?.verified) throw badRequest("This domain's DNS records need checking before it can send.");
    return box;
  }

  app.post("/mail/drafts", async (request) => {
    const ws = workspaceOf(request);
    const b = compose.extend({ id: z.string().optional() }).parse(request.body);
    const box = await senderBox(ws, b.mailboxId);
    const data = { to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, text: b.text, html: cleanHtml(b.html), snippet: snippetOf(b.text), size: sizeOf({ subject: b.subject, text: b.text, html: b.html }) };
    if (b.id) {
      const d = await dbOf(app).mailMessage.findFirst({ where: { id: b.id, mailboxId: box.id, folder: "drafts" } });
      if (!d) throw notFound("Draft not found.");
      await dbOf(app).mailMessage.update({ where: { id: d.id }, data });
      return { status: 200, message: "Draft saved.", data: { id: d.id } };
    }
    const id = createId();
    await dbOf(app).mailMessage.create({ data: { ...data, id, mailboxId: box.id, tenantId: box.tenantId, folder: "drafts", threadId: id, messageId: `<${id}@${box.address.split("@")[1]}>`, fromAddress: box.address, fromName: box.name, status: "draft", seen: true } });
    return { status: 200, message: "Draft saved.", data: { id } };
  });

  app.post("/mail/send", { bodyLimit: 30 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const ws = workspaceOf(request);
    const b = compose.parse(request.body);
    const box = await senderBox(ws, b.mailboxId);
    const all = [...new Set([...b.to, ...b.cc, ...b.bcc])];
    if (!all.length) throw badRequest("Add at least one recipient.", { to: ["Add at least one recipient."] });
    if (!b.subject && !b.text.trim()) throw badRequest("Write a subject or a message.");

    const files = b.attachments.map(fileOf);
    const attachBytes = files.reduce((s, f) => s + f.size, 0);
    if (attachBytes > MAX_ATTACH) throw badRequest("Attachments can be up to 20 MB in one email.");
    const html = cleanHtml(b.html);
    const size = sizeOf({ subject: b.subject, text: b.text, html }, attachBytes);
    if ((await used(ws.tenantId)) + size > quotaOf(ws)) throw new AppError(413, "storage_full", "Your email storage is full. Empty Trash or delete old mail with large attachments.");

    const db = dbOf(app);
    const answered = b.replyTo ? await db.mailMessage.findFirst({ where: { id: b.replyTo, mailbox: visibleWhere(ws) } }) : null;
    const id = createId();
    const threadId = answered?.threadId ?? id;
    const messageId = `<${id}@${box.address.split("@")[1]}>`;
    const now = new Date();

    // Recipients with a Sheetal mailbox get it at once; everyone else waits for the mail server.
    const local = await db.mailbox.findMany({ where: { address: { in: all }, active: true }, include: { domain: { select: { tenantId: true } } } });
    const external = all.filter((a) => !local.some((m) => m.address === a));
    const common = { threadId, messageId, inReplyTo: answered?.messageId ?? null, fromAddress: box.address, fromName: box.name, to: b.to, cc: b.cc, subject: b.subject, text: b.text, html, snippet: snippetOf(b.text), size, sentAt: now };
    const attachCreate = { create: files };

    await db.$transaction(async (tx) => {
      await tx.mailMessage.create({ data: { ...common, id, bcc: b.bcc, mailboxId: box.id, tenantId: box.tenantId, folder: "sent", seen: true, status: external.length ? "queued" : "delivered", attachments: attachCreate,
        // One delivery per outside recipient; the mail server works through them (mail-server/src/outbound.ts).
        deliveries: { create: external.map((recipient) => ({ recipient, tenantId: box.tenantId })) } } });
      for (const r of local) {
        // A teammate's mailbox, or another Sheetal business; never more than their storage allows.
        const theirUsed = (await tx.mailMessage.aggregate({ where: { tenantId: r.tenantId }, _sum: { size: true } }))._sum.size ?? 0;
        const theirTenant = await tx.tenant.findUnique({ where: { id: r.tenantId }, include: { plan: true } });
        if (!theirTenant || theirUsed + size > mailQuotaBytes(theirTenant.plan)) continue;
        await tx.mailMessage.create({ data: { ...common, mailboxId: r.id, tenantId: r.tenantId, folder: "inbox", status: "received", attachments: attachCreate } });
      }
      if (b.draftId) await tx.mailMessage.deleteMany({ where: { id: b.draftId, mailboxId: box.id, folder: "drafts" } });
    });
    return { status: 200, message: external.length ? "Sent. Outside recipients get it from the mail server shortly." : "Sent.", data: { id, queued: external, delivered: local.map((m) => m.address) } };
  });

  // ───── From the mail server (part 2): incoming mail for Sheetal mailboxes ─────
  app.post("/mail/inbound", { bodyLimit: 40 * 1024 * 1024, config: { rateLimit: false } }, async (request, reply) => {
    const secret = app.config.MAIL_INBOUND_SECRET;
    const given = request.headers["x-mail-secret"];
    if (!secret || typeof given !== "string" || !safeEqual(given, secret)) throw forbidden("Not allowed.");
    const b = z.object({
      to: z.array(address).min(1).max(100), from: address, fromName: z.string().max(200).optional(),
      cc: addresses, subject: z.string().max(1000).default(""), text: z.string().max(2_000_000).default(""), html: z.string().max(5_000_000).optional(),
      messageId: z.string().max(500), inReplyTo: z.string().max(500).optional(), spam: z.boolean().default(false),
      attachments: z.array(attachment).max(50).default([]),
    }).parse(request.body);
    const db = dbOf(app);
    const boxes = await db.mailbox.findMany({ where: { address: { in: b.to }, active: true }, include: { domain: true } });
    const files = b.attachments.map(fileOf);
    const html = cleanHtml(b.html);
    const size = sizeOf({ subject: b.subject, text: b.text, html }, files.reduce((s, f) => s + f.size, 0));
    const delivered: string[] = [], full: string[] = [];
    for (const box of boxes) {
      const tenant = await db.tenant.findUnique({ where: { id: box.tenantId }, include: { plan: true } });
      if (!tenant || (await used(box.tenantId)) + size > mailQuotaBytes(tenant.plan)) { full.push(box.address); continue; }
      const parent = b.inReplyTo ? await db.mailMessage.findFirst({ where: { mailboxId: box.id, messageId: b.inReplyTo }, select: { threadId: true } }) : null;
      const id = createId();
      await db.mailMessage.create({ data: {
        id, mailboxId: box.id, tenantId: box.tenantId, folder: b.spam ? "spam" : "inbox", threadId: parent?.threadId ?? id, messageId: b.messageId, inReplyTo: b.inReplyTo,
        fromAddress: b.from, fromName: b.fromName, to: b.to, cc: b.cc, subject: b.subject, text: b.text, html, snippet: snippetOf(b.text), size, status: "received", sentAt: new Date(),
        attachments: { create: files },
      } });
      delivered.push(box.address);
    }
    const unknown = b.to.filter((a) => !boxes.some((x) => x.address === a));
    // The mail server bounces the ones listed as unknown or full.
    return reply.status(delivered.length ? 200 : 404).send({ delivered, full, unknown });
  });
}
