// The only code of business email that reads and writes tables (KERNEL.md section 6). Moved out of business/backend/src/modules/mail/routes.ts in P2-W6
// (Workspace part 2).
// Where it fits: MailService calls these, in its transaction for a change.
// How it works: domains, mailboxes (with who else may open them), messages, attachments and deliveries. `visible` is the mailbox filter the service
// worked out (every mailbox of the business, or the person's own and the shared ones they were given).
// Rules: every query carries this business, with two exceptions that are the point of email: mail between Sheetal mailboxes is put straight into the
// recipient's mailbox (which may be another business), and the mail server hands in incoming mail for any Sheetal mailbox. Both check the receiving
// business's storage first.

import type { Prisma } from "@prisma/client";
import type { BusinessContext } from "@sheetal/platform/core/context";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;

export class MailRepository {
  used(d: Tx, tenantId: string) { return d.mailMessage.aggregate({ where: { tenantId }, _sum: { size: true } }).then((r) => r._sum.size ?? 0); }
  tenantPlan(d: Tx, tenantId: string) { return d.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } }); }
  myPlan(ctx: BusinessContext) { return db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id }, include: { plan: true } }).then((t) => t.plan); }

  unread(ctx: BusinessContext, userId: string) {
    return db(ctx).mailMessage.count({ where: { folder: "inbox", seen: false, mailbox: { tenantId: ctx.business.id, active: true, OR: [{ userId }, { access: { some: { userId } } }] } } });
  }
  domains(ctx: BusinessContext) { return db(ctx).mailDomain.findMany({ where: { tenantId: ctx.business.id }, orderBy: { createdAt: "asc" } }); }
  boxes(ctx: BusinessContext, visible: Prisma.MailboxWhereInput) { return db(ctx).mailbox.findMany({ where: visible, include: { access: { select: { userId: true } } }, orderBy: [{ kind: "asc" }, { address: "asc" }] }); }
  unreadByBox(ctx: BusinessContext, boxIds: string[]) { return db(ctx).mailMessage.groupBy({ by: ["mailboxId"], where: { mailboxId: { in: boxIds }, folder: "inbox", seen: false }, _count: true }); }

  // ───── Domains ─────
  domainByName(ctx: BusinessContext, name: string) { return db(ctx).mailDomain.findUnique({ where: { name } }); }
  domain(ctx: BusinessContext, id: string) { return db(ctx).mailDomain.findFirst({ where: { id, tenantId: ctx.business.id } }); }
  domainWithCount(ctx: BusinessContext, id: string) { return db(ctx).mailDomain.findFirst({ where: { id, tenantId: ctx.business.id }, include: { _count: { select: { mailboxes: true } } } }); }
  addDomain(ctx: BusinessContext, d: { name: string; verifyToken: string; dkimPublicKey: string; dkimPrivateKey: string }) { return db(ctx).mailDomain.create({ data: { ...d, tenantId: ctx.business.id } }); }
  saveChecks(ctx: BusinessContext, id: string, checks: Prisma.InputJsonValue, verified: boolean) { return db(ctx).mailDomain.update({ where: { id }, data: { checks, checkedAt: new Date(), verified } }); }
  removeDomain(ctx: BusinessContext, id: string) { return db(ctx).mailDomain.deleteMany({ where: { id, tenantId: ctx.business.id } }); }

  // ───── Mailboxes ─────
  team(ctx: BusinessContext) {
    return db(ctx).membership.findMany({ where: { tenantId: ctx.business.id, status: "active" }, include: { user: { select: { id: true, userName: true, email: true } }, role: { select: { key: true, name: true } } }, orderBy: { createdAt: "asc" } });
  }
  activeMembers(ctx: BusinessContext, userIds: string[]) { return db(ctx).membership.count({ where: { tenantId: ctx.business.id, userId: { in: userIds }, status: "active" } }); }
  boxByAddress(ctx: BusinessContext, address: string) { return db(ctx).mailbox.findUnique({ where: { address } }); }
  box(ctx: BusinessContext, id: string) { return db(ctx).mailbox.findFirst({ where: { id, tenantId: ctx.business.id } }); }
  visibleBox(ctx: BusinessContext, visible: Prisma.MailboxWhereInput, id: string) { return db(ctx).mailbox.findFirst({ where: { AND: [{ id }, visible] } }); }
  addBox(ctx: BusinessContext, d: { domainId: string; address: string; name: string; kind: string; userId: string | null; accessUserIds: string[] }) {
    return db(ctx).mailbox.create({ data: { tenantId: ctx.business.id, domainId: d.domainId, address: d.address, name: d.name, kind: d.kind, userId: d.userId, access: { create: d.accessUserIds.map((userId) => ({ userId })) } } });
  }
  /** Only a mailbox of this business, found by the caller first. */
  changeBox(ctx: BusinessContext, id: string, d: { name?: string; active?: boolean; accessUserIds?: string[] }) {
    return db(ctx).mailbox.update({ where: { id }, data: { name: d.name, active: d.active, ...(d.accessUserIds ? { access: { deleteMany: {}, create: d.accessUserIds.map((userId) => ({ userId })) } } : {}) } });
  }
  removeBox(ctx: BusinessContext, id: string) { return db(ctx).mailbox.deleteMany({ where: { id, tenantId: ctx.business.id } }); }

  // ───── Messages ─────
  message(ctx: BusinessContext, visible: Prisma.MailboxWhereInput, id: string) {
    return db(ctx).mailMessage.findFirst({ where: { id, mailbox: visible }, include: { attachments: { select: { id: true, filename: true, contentType: true, size: true } } } });
  }
  page(ctx: BusinessContext, where: Prisma.MailMessageWhereInput, skip: number, take: number, boxId: string) {
    return Promise.all([
      db(ctx).mailMessage.count({ where }),
      db(ctx).mailMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip, take,
        select: { id: true, threadId: true, fromAddress: true, fromName: true, to: true, subject: true, snippet: true, seen: true, starred: true, status: true, createdAt: true, sentAt: true, _count: { select: { attachments: true } } } }),
      db(ctx).mailMessage.groupBy({ by: ["folder"], where: { mailboxId: boxId, seen: false }, _count: true }),
    ]);
  }
  thread(ctx: BusinessContext, threadId: string, mailboxId: string) {
    return db(ctx).mailMessage.findMany({ where: { threadId, mailboxId, folder: { not: "trash" } }, orderBy: { createdAt: "asc" }, select: { id: true, fromAddress: true, fromName: true, subject: true, snippet: true, createdAt: true } });
  }
  attachment(ctx: BusinessContext, visible: Prisma.MailboxWhereInput, id: string) { return db(ctx).mailAttachment.findFirst({ where: { id, message: { mailbox: visible } } }); }
  /** Only a message the caller found through a visible mailbox. */
  changeMessage(ctx: BusinessContext, id: string, data: Prisma.MailMessageUpdateInput) { return db(ctx).mailMessage.update({ where: { id }, data }); }
  deleteMessage(ctx: BusinessContext, id: string) { return db(ctx).mailMessage.delete({ where: { id } }); }
  draft(ctx: BusinessContext, id: string, mailboxId: string) { return db(ctx).mailMessage.findFirst({ where: { id, mailboxId, folder: "drafts" } }); }
  createMessage(ctx: BusinessContext, data: Prisma.MailMessageUncheckedCreateInput) { return db(ctx).mailMessage.create({ data }); }
  domainOf(ctx: BusinessContext, id: string) { return db(ctx).mailDomain.findUnique({ where: { id } }); }
  answered(ctx: BusinessContext, visible: Prisma.MailboxWhereInput, id: string) { return db(ctx).mailMessage.findFirst({ where: { id, mailbox: visible } }); }
  /** Active Sheetal mailboxes with these addresses, in any business (mail between Sheetal mailboxes is delivered at once). */
  sheetalBoxes(d: Tx, addresses: string[]) { return d.mailbox.findMany({ where: { address: { in: addresses }, active: true }, include: { domain: true } }); }
  /** Delivers into a Sheetal mailbox, which may belong to another business. */
  deliver(d: Tx, data: Prisma.MailMessageUncheckedCreateInput) { return d.mailMessage.create({ data }); }
  dropDraft(ctx: BusinessContext, id: string, mailboxId: string) { return db(ctx).mailMessage.deleteMany({ where: { id, mailboxId, folder: "drafts" } }); }
  parentThread(d: Tx, mailboxId: string, messageId: string) { return d.mailMessage.findFirst({ where: { mailboxId, messageId }, select: { threadId: true } }); }
}
