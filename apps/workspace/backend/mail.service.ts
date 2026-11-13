// Business email on the kernel: own domains, mailboxes (personal and shared), folders, reading, sending, drafts and attachments. Moved from
// business/backend/src/modules/mail/routes.ts in P2-W6 (Workspace part 2); every rule, message and status code unchanged.
// Where it fits: MailController calls one method per route (the panel's Email page and Settings → Domain and email); the mail server calls inbound().
// How it works: mail between Sheetal mailboxes is delivered at once; mail to anyone else is queued for the mail server, which signs and sends it. Storage
// counts every message and attachment against the plan (1 GB on paid plans). Setting email up (domains, mailboxes) runs in ONE transaction with an audit
// line and an event; sending writes its event in the same transaction as the message. Reading, flags, folders and drafts are a person's own mail work:
// they write no audit line (as before), so the Team activity list stays about the business.
// Rules: everyone uses their own mailbox and the shared ones they were given; the business settings permissions add domains and mailboxes; people who
// manage the team can open every team mailbox; inbound mail needs the shared secret.

import { z } from "zod";
import type { Mailbox, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { AppError, badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BusinessEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import { newToken, safeEqual } from "@sheetal/platform/auth/secrets";
import type { Vault } from "@sheetal/platform/auth/vault";
import { mailQuotaBytes } from "@sheetal/backend-core/domain/plans";
import { checkRecords, isVerified, newDkimKeys, recordsFor, type Resolver } from "./mail-dns.js";
import { MailRepository } from "./mail.repository.js";
import { SETTINGS_PERM } from "./workspace.service.js";
import { TEAM_PERM } from "./team.service.js";

type Tx = Prisma.TransactionClient;
const FOLDERS = ["inbox", "sent", "drafts", "archive", "spam", "trash"] as const;
const MAX_ATTACH = 20 * 1024 * 1024; // all attachments of one email
const PAGE = 50;
/** A new id for a message (also used inside its Message-ID header). */
export const createId = () => randomUUID().replace(/-/g, "");

const address = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
const addresses = z.array(address).max(100).default([]);
const domainName = z.string().trim().toLowerCase().regex(/^(?=.{3,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,63}$/, "Enter a domain like yourbusiness.com.");
const localPart = z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/, "Use letters, numbers, dots, dashes or underscores.");
const attachment = z.object({ filename: z.string().trim().min(1).max(200), contentType: z.string().max(120).default("application/octet-stream"), data: z.string().max(30_000_000) });
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
type Line = { audit: { action: string; target: string } | null; event: { name: string; payload: object } };

class MailBase extends BaseRepository<BusinessEntity, never, never> {
  constructor() { super({ model: "mailbox", branchField: null, ownerField: null, label: "This mailbox", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "asc" }] }); }
}
export interface MailDeps { bus: EventBus; db: unknown; vault: Vault; resolver: Resolver; mailHost: string; inboundSecret: string | undefined; log?: FastifyBaseLogger }

export class MailService extends BaseService<BusinessEntity, never, never> {
  readonly mail = new MailRepository();
  constructor(private readonly x: MailDeps) {
    super({ app: "workspace", resource: "mail", repo: new MailBase(), permissions: { read: SETTINGS_PERM, create: SETTINGS_PERM, update: SETTINGS_PERM, delete: SETTINGS_PERM },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "mail", label: (m) => m.id }, bus: x.bus, requireVersion: false });
  }
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => Line): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      if (a.audit) await this.writeAudit(tx, a.audit.action, a.audit.target);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1);
      return r;
    });
  }
  /** A person's own mail work (flags, folders, drafts): refused in a read-only support session, no audit line. */
  private own<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>): Promise<R> { this.refuseReadOnly(ctx); return this.inTransaction(ctx, run); }
  private me(ctx: BusinessContext) { return ctx.member.userId; }
  private async quota(ctx: BusinessContext) { return mailQuotaBytes(await this.mail.myPlan(ctx)); }
  private async paidOnly(ctx: BusinessContext) { if (!(await this.quota(ctx))) throw new AppError(402, "upgrade_needed", "Team email is part of the Business and Pro plans."); }
  private async manage(ctx: BusinessContext) { await this.paidOnly(ctx); if (!ctx.permissions.can(SETTINGS_PERM)) throw forbidden("Only owners and managers can set up email."); }
  /** Mailboxes this person may open in this business. */
  private visible(ctx: BusinessContext): Prisma.MailboxWhereInput {
    return ctx.permissions.can(TEAM_PERM) ? { tenantId: ctx.business.id } : { tenantId: ctx.business.id, OR: [{ userId: this.me(ctx) }, { access: { some: { userId: this.me(ctx) } } }] };
  }
  private async boxFor(ctx: BusinessContext, id: string): Promise<Mailbox> {
    const box = await this.mail.visibleBox(ctx, this.visible(ctx), id);
    if (!box) throw notFound("Mailbox not found.");
    return box;
  }
  private async messageFor(ctx: BusinessContext, id: string) {
    const m = await this.mail.message(ctx, this.visible(ctx), id);
    if (!m) throw notFound("Email not found.");
    return m;
  }
  private domainJson(d: { id: string; name: string; verified: boolean; verifyToken: string; dkimSelector: string; dkimPublicKey: string; checks: unknown; checkedAt: Date | null }) {
    const checks = (d.checks ?? {}) as Record<string, string>;
    return { id: d.id, name: d.name, verified: d.verified, checkedAt: d.checkedAt, records: recordsFor(d.name, d, this.x.mailHost).map((r) => ({ ...r, status: checks[r.id] ?? "unchecked" })) };
  }
  private async memberIds(ctx: BusinessContext, ids: string[]) {
    if (!ids.length) return;
    if ((await this.mail.activeMembers(ctx, ids)) !== new Set(ids).size) throw badRequest("Mailboxes can only be given to people in your team.");
  }

  // ───── Unread email for the top bar, and the Email page overview ─────
  async unread(ctx: BusinessContext) { return { unread: await this.mail.unread(ctx, this.me(ctx)) }; }
  async overview(ctx: BusinessContext) {
    const db = (ctx.tx ?? ctx.db) as unknown as Tx;
    const [domains, boxes, usedBytes, quota] = await Promise.all([this.mail.domains(ctx), this.mail.boxes(ctx, this.visible(ctx)), this.mail.used(db, ctx.business.id), this.quota(ctx)]);
    const unread = await this.mail.unreadByBox(ctx, boxes.map((b) => b.id));
    const unreadOf = new Map(unread.map((u) => [u.mailboxId, u._count]));
    return {
      paid: quota > 0, canManage: ctx.permissions.can(SETTINGS_PERM), canSeeAll: ctx.permissions.can(TEAM_PERM),
      quota: { used: usedBytes, limit: quota },
      domains: domains.map((d) => this.domainJson(d)),
      mailboxes: boxes.map((b) => ({ id: b.id, address: b.address, name: b.name, kind: b.kind, userId: b.userId, active: b.active, mine: b.userId === this.me(ctx), accessUserIds: b.access.map((a) => a.userId), unread: unreadOf.get(b.id) ?? 0 })),
    };
  }

  // ───── Domains ─────
  async addDomain(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    await this.manage(ctx);
    const { name } = z.object({ name: domainName }).parse(raw);
    if (await this.mail.domainByName(ctx, name)) throw conflict("This domain is already connected to Sheetal.");
    const keys = newDkimKeys();
    const d = await this.write(ctx, (tx) => this.mail.addDomain(tx, { name, verifyToken: newToken(18), dkimPublicKey: keys.publicKey, dkimPrivateKey: this.x.vault.seal(keys.privateKey) }),
      (d) => ({ audit: { action: "mail.domain_added", target: name }, event: { name: "workspace.maildomain.added", payload: { id: d.id } } }));
    return { status: 200, message: "Domain added. Add the DNS records, then check them.", data: this.domainJson(d) };
  }
  async checkDomain(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    await this.manage(ctx);
    const d = await this.mail.domain(ctx, id);
    if (!d) throw notFound("Domain not found.");
    const checks = await checkRecords(this.x.resolver, d.name, d, this.x.mailHost);
    const saved = await this.write(ctx, (tx) => this.mail.saveChecks(tx, d.id, checks as Prisma.InputJsonValue, isVerified(checks)),
      (s) => ({ audit: null, event: { name: "workspace.maildomain.checked", payload: { id: d.id, verified: s.verified } } }));
    return { status: 200, message: saved.verified ? "All set: you can create mailboxes." : "Some records are not there yet. DNS changes can take up to an hour.", data: this.domainJson(saved) };
  }
  async removeDomain(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    await this.manage(ctx);
    const d = await this.mail.domainWithCount(ctx, id);
    if (!d) throw notFound("Domain not found.");
    if (d._count.mailboxes) throw conflict("Delete this domain's mailboxes first.");
    await this.write(ctx, (tx) => this.mail.removeDomain(tx, d.id), () => ({ audit: { action: "mail.domain_removed", target: d.name }, event: { name: "workspace.maildomain.removed", payload: { id: d.id } } }));
    return { status: 200, message: "Domain removed." };
  }

  // ───── Mailboxes ─────
  async team(ctx: BusinessContext) {
    await this.manage(ctx);
    const rows = await this.mail.team(ctx);
    return rows.map((m) => ({ userId: m.user.id, name: m.user.userName, email: m.user.email, role: m.role.name ?? m.role.key }));
  }
  async addBox(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    await this.manage(ctx);
    const b = z.object({
      domainId: z.string().min(1), local: localPart, name: z.string().trim().min(1).max(80),
      kind: z.enum(["person", "shared"]).default("person"), userId: z.string().optional(), accessUserIds: z.array(z.string()).max(50).default([]),
    }).parse(raw);
    const d = await this.mail.domain(ctx, b.domainId);
    if (!d) throw notFound("Domain not found.");
    if (!d.verified) throw badRequest("Check the domain's DNS records first; mailboxes open once they are all green.");
    if (b.kind === "person" && !b.userId) throw badRequest("Choose the team member this mailbox is for.");
    await this.memberIds(ctx, [...(b.userId ? [b.userId] : []), ...b.accessUserIds]);
    const full = `${b.local}@${d.name}`;
    if (await this.mail.boxByAddress(ctx, full)) throw conflict(`${full} already exists.`);
    const box = await this.write(ctx, (tx) => this.mail.addBox(tx, { domainId: d.id, address: full, name: b.name, kind: b.kind, userId: b.kind === "person" ? b.userId ?? null : null, accessUserIds: b.accessUserIds }),
      (box) => ({ audit: { action: "mail.mailbox_added", target: full }, event: { name: "workspace.mailbox.added", payload: { id: box.id } } }));
    return { status: 200, message: `${box.address} is ready.`, data: { id: box.id, address: box.address } };
  }
  async changeBox(ctx: BusinessContext, id: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    await this.manage(ctx);
    const b = z.object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional(), accessUserIds: z.array(z.string()).max(50).optional() }).parse(raw);
    const box = await this.mail.box(ctx, id);
    if (!box) throw notFound("Mailbox not found.");
    if (b.accessUserIds) await this.memberIds(ctx, b.accessUserIds);
    await this.write(ctx, (tx) => this.mail.changeBox(tx, box.id, b), () => ({ audit: { action: "mail.mailbox_updated", target: box.address }, event: { name: "workspace.mailbox.updated", payload: { id: box.id } } }));
    return { status: 200, message: "Mailbox updated." };
  }
  async removeBox(ctx: BusinessContext, id: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    await this.manage(ctx);
    const { confirm } = z.object({ confirm: z.string() }).parse(raw ?? {});
    const box = await this.mail.box(ctx, id);
    if (!box) throw notFound("Mailbox not found.");
    if (confirm.trim().toLowerCase() !== box.address) throw badRequest("Type the full address to confirm. All its mail will be deleted.");
    await this.write(ctx, (tx) => this.mail.removeBox(tx, box.id), () => ({ audit: { action: "mail.mailbox_removed", target: box.address }, event: { name: "workspace.mailbox.removed", payload: { id: box.id } } }));
    return { status: 200, message: `${box.address} and its mail were deleted.` };
  }

  // ───── Reading ─────
  async messages(ctx: BusinessContext, boxId: string, rawQuery: unknown) {
    const box = await this.boxFor(ctx, boxId);
    const q = z.object({ folder: z.enum(FOLDERS).default("inbox"), q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(1000).default(1) }).parse(rawQuery);
    const where: Prisma.MailMessageWhereInput = {
      mailboxId: box.id, folder: q.folder,
      ...(q.q ? { OR: [{ subject: { contains: q.q, mode: "insensitive" } }, { fromAddress: { contains: q.q, mode: "insensitive" } }, { fromName: { contains: q.q, mode: "insensitive" } }, { text: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    const [total, rows, unread] = await this.mail.page(ctx, where, (q.page - 1) * PAGE, PAGE, box.id);
    return {
      data: rows.map(({ _count, ...m }) => ({ ...m, attachments: _count.attachments })),
      meta: { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / PAGE)), per_page: PAGE },
      unread: Object.fromEntries(unread.map((u) => [u.folder, u._count])),
    };
  }
  async read(ctx: BusinessContext, id: string) {
    const m = await this.messageFor(ctx, id);
    // Marking it read is the reader's own state; a read-only support session reads without marking.
    if (!m.seen && !ctx.impersonation) await this.own(ctx, (tx) => this.mail.changeMessage(tx, m.id, { seen: true }));
    const thread = await this.mail.thread(ctx, m.threadId, m.mailboxId);
    return { ...m, seen: true, thread };
  }
  async attachment(ctx: BusinessContext, id: string) {
    const a = await this.mail.attachment(ctx, this.visible(ctx), id);
    if (!a) throw notFound("Attachment not found.");
    return a;
  }
  async flag(ctx: BusinessContext, id: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    const m = await this.messageFor(ctx, id);
    const b = z.object({ folder: z.enum(FOLDERS).optional(), seen: z.boolean().optional(), starred: z.boolean().optional() }).parse(raw);
    if (b.folder === "drafts" || (m.folder === "drafts" && b.folder && b.folder !== "trash")) throw badRequest("Drafts can only be sent or deleted.");
    await this.own(ctx, (tx) => this.mail.changeMessage(tx, m.id, b));
    return { status: 200, message: b.folder ? `Moved to ${b.folder}.` : "Saved." };
  }
  async trash(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    const m = await this.messageFor(ctx, id);
    if (m.folder === "trash" || m.folder === "drafts") {
      await this.own(ctx, (tx) => this.mail.deleteMessage(tx, m.id));
      return { status: 200, message: "Deleted for good." };
    }
    await this.own(ctx, (tx) => this.mail.changeMessage(tx, m.id, { folder: "trash" }));
    return { status: 200, message: "Moved to Trash." };
  }

  // ───── Writing ─────
  private async senderBox(ctx: BusinessContext, id: string) {
    await this.paidOnly(ctx);
    const box = await this.boxFor(ctx, id);
    if (!box.active) throw badRequest("This mailbox is switched off.");
    const domain = await this.mail.domainOf(ctx, box.domainId);
    if (!domain?.verified) throw badRequest("This domain's DNS records need checking before it can send.");
    return box;
  }
  async saveDraft(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    const b = compose.extend({ id: z.string().optional() }).parse(raw);
    const box = await this.senderBox(ctx, b.mailboxId);
    const data = { to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, text: b.text, html: cleanHtml(b.html), snippet: snippetOf(b.text), size: sizeOf({ subject: b.subject, text: b.text, html: b.html }) };
    if (b.id) {
      const d = await this.mail.draft(ctx, b.id, box.id);
      if (!d) throw notFound("Draft not found.");
      await this.own(ctx, (tx) => this.mail.changeMessage(tx, d.id, data));
      return { status: 200, message: "Draft saved.", data: { id: d.id } };
    }
    const id = createId();
    await this.own(ctx, (tx) => this.mail.createMessage(tx, { ...data, id, mailboxId: box.id, tenantId: box.tenantId, folder: "drafts", threadId: id, messageId: `<${id}@${box.address.split("@")[1]}>`, fromAddress: box.address, fromName: box.name, status: "draft", seen: true }));
    return { status: 200, message: "Draft saved.", data: { id } };
  }
  async send(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    const b = compose.parse(raw);
    const box = await this.senderBox(ctx, b.mailboxId);
    const all = [...new Set([...b.to, ...b.cc, ...b.bcc])];
    if (!all.length) throw badRequest("Add at least one recipient.", { to: ["Add at least one recipient."] });
    if (!b.subject && !b.text.trim()) throw badRequest("Write a subject or a message.");
    const files = b.attachments.map(fileOf);
    const attachBytes = files.reduce((s, f) => s + f.size, 0);
    if (attachBytes > MAX_ATTACH) throw badRequest("Attachments can be up to 20 MB in one email.");
    const html = cleanHtml(b.html);
    const size = sizeOf({ subject: b.subject, text: b.text, html }, attachBytes);
    const db = (ctx.tx ?? ctx.db) as unknown as Tx;
    if ((await this.mail.used(db, ctx.business.id)) + size > (await this.quota(ctx))) throw new AppError(413, "storage_full", "Your email storage is full. Empty Trash or delete old mail with large attachments.");
    const answered = b.replyTo ? await this.mail.answered(ctx, this.visible(ctx), b.replyTo) : null;
    const id = createId();
    const threadId = answered?.threadId ?? id;
    const messageId = `<${id}@${box.address.split("@")[1]}>`;
    const now = new Date();
    // Recipients with a Sheetal mailbox get it at once; everyone else waits for the mail server.
    const local = await this.mail.sheetalBoxes(db, all);
    const external = all.filter((a) => !local.some((m) => m.address === a));
    const common = { threadId, messageId, inReplyTo: answered?.messageId ?? null, fromAddress: box.address, fromName: box.name, to: b.to, cc: b.cc, subject: b.subject, text: b.text, html, snippet: snippetOf(b.text), size, sentAt: now };
    const attachCreate = { create: files };
    await this.write(ctx, async (tx) => {
      const t = tx.tx as unknown as Tx;
      await this.mail.createMessage(tx, { ...common, id, bcc: b.bcc, mailboxId: box.id, tenantId: box.tenantId, folder: "sent", seen: true, status: external.length ? "queued" : "delivered", attachments: attachCreate,
        // One delivery per outside recipient; the mail server works through them (mail-server/src/outbound.ts).
        deliveries: { create: external.map((recipient) => ({ recipient, tenantId: box.tenantId })) } });
      for (const r of local) {
        // A teammate's mailbox, or another Sheetal business; never more than their storage allows.
        const theirUsed = await this.mail.used(t, r.tenantId);
        const theirTenant = await this.mail.tenantPlan(t, r.tenantId);
        if (!theirTenant || theirUsed + size > mailQuotaBytes(theirTenant.plan)) continue;
        await this.mail.deliver(t, { ...common, mailboxId: r.id, tenantId: r.tenantId, folder: "inbox", status: "received", attachments: attachCreate });
      }
      if (b.draftId) await this.mail.dropDraft(tx, b.draftId, box.id);
    }, () => ({ audit: null, event: { name: "workspace.mail.sent", payload: { id, recipients: all.length } } }));
    return { status: 200, message: external.length ? "Sent. Outside recipients get it from the mail server shortly." : "Sent.", data: { id, queued: external, delivered: local.map((m) => m.address) } };
  }

  // ───── From the mail server: incoming mail for Sheetal mailboxes (no business context: the shared secret is the check) ─────
  async inbound(secretGiven: unknown, raw: unknown) {
    const secret = this.x.inboundSecret;
    if (!secret || typeof secretGiven !== "string" || !safeEqual(secretGiven, secret)) throw forbidden("Not allowed.");
    const b = z.object({
      to: z.array(address).min(1).max(100), from: address, fromName: z.string().max(200).optional(),
      cc: addresses, subject: z.string().max(1000).default(""), text: z.string().max(2_000_000).default(""), html: z.string().max(5_000_000).optional(),
      messageId: z.string().max(500), inReplyTo: z.string().max(500).optional(), spam: z.boolean().default(false),
      attachments: z.array(attachment).max(50).default([]),
    }).parse(raw);
    const db = this.x.db as Tx;
    const boxes = await this.mail.sheetalBoxes(db, b.to);
    const files = b.attachments.map(fileOf);
    const html = cleanHtml(b.html);
    const size = sizeOf({ subject: b.subject, text: b.text, html }, files.reduce((s, f) => s + f.size, 0));
    const delivered: string[] = [], full: string[] = [];
    for (const box of boxes) {
      const tenant = await this.mail.tenantPlan(db, box.tenantId);
      if (!tenant || (await this.mail.used(db, box.tenantId)) + size > mailQuotaBytes(tenant.plan)) { full.push(box.address); continue; }
      const parent = b.inReplyTo ? await this.mail.parentThread(db, box.id, b.inReplyTo) : null;
      const id = createId();
      await this.mail.deliver(db, {
        id, mailboxId: box.id, tenantId: box.tenantId, folder: b.spam ? "spam" : "inbox", threadId: parent?.threadId ?? id, messageId: b.messageId, inReplyTo: b.inReplyTo,
        fromAddress: b.from, fromName: b.fromName, to: b.to, cc: b.cc, subject: b.subject, text: b.text, html, snippet: snippetOf(b.text), size, status: "received", sentAt: new Date(),
        attachments: { create: files },
      });
      delivered.push(box.address);
    }
    const unknown = b.to.filter((a) => !boxes.some((x) => x.address === a));
    // The mail server bounces the ones listed as unknown or full.
    return { status: delivered.length ? 200 : 404, body: { delivered, full, unknown } };
  }
}
