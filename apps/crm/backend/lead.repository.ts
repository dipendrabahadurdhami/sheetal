// The only code that reads and writes leads and their messages for the business panel (KERNEL.md section 6).
// Where it fits: LeadService calls it. Leads are also created elsewhere (website enquiries, chat channels, the lead finder): those writers move with W6.
// How it works: every read carries this business, "not deleted", the branches in view, and WHO may see which lead (mine()):
// people who can assign leads (and owners) see every lead in view; everyone else sees the leads given to them AND the leads nobody has taken yet
// (unassigned). The second half is easy to lose and is pinned by a test (crm-kernel.test.ts).
// Lead messages are an append-only conversation, so they carry no kernel columns. It also reads, never writes, listings, team members, branches and the
// business's chat channels (manifest dependencies.reads).
// Rules: nothing is hard deleted.

import type { Prisma } from "@prisma/client";
import { actorIdOf, type BusinessContext } from "@sheetal/platform/core/context";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
const inView = (ctx: BusinessContext) => { const ids = ctx.branches.idsFor("branch"); return ids ? { branchId: { in: [...ids] } } : {}; };

export class LeadRepository {
  /** The leads this person may see: in view, and (unless they see all) theirs or nobody's. */
  mine(ctx: BusinessContext, all: boolean): Prisma.LeadWhereInput {
    return { tenantId: ctx.business.id, deletedAt: null, ...inView(ctx), ...(all ? {} : { OR: [{ assigneeId: ctx.member.userId }, { assigneeId: null }] }) };
  }
  list(ctx: BusinessContext, all: boolean, stage: string | undefined, take: number) {
    return db(ctx).lead.findMany({ where: { ...this.mine(ctx, all), ...(stage ? { status: stage } : {}) }, include: { messages: { orderBy: { createdAt: "asc" } }, branch: { select: { name: true } } }, orderBy: { lastAt: "desc" }, take });
  }
  one(ctx: BusinessContext, all: boolean, id: string) { return db(ctx).lead.findFirst({ where: { AND: [this.mine(ctx, all), { id }] } }); }
  /** Changes a lead (on `version` when one is given). False = someone changed it first. */
  async change(ctx: BusinessContext, id: string, data: Prisma.LeadUncheckedUpdateManyInput, version?: number): Promise<boolean> {
    return (await db(ctx).lead.updateMany({ where: { id, tenantId: ctx.business.id, ...(version !== undefined ? { version } : {}) }, data: { ...data, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } })).count > 0;
  }
  addMessage(ctx: BusinessContext, leadId: string, body: string) { return db(ctx).leadMessage.create({ data: { leadId, direction: "out", body, userId: ctx.member.userId } }); }

  // ── Read only ──
  listings(ctx: BusinessContext, ids: number[]) { return db(ctx).listing.findMany({ where: { id: { in: ids }, tenantId: ctx.business.id }, select: { id: true, code: true, title: true, price: true } }); }
  userNames(ctx: BusinessContext, ids: string[]) { return db(ctx).user.findMany({ where: { id: { in: ids } }, select: { id: true, userName: true } }); }
  member(ctx: BusinessContext, userId: string) { return db(ctx).membership.findFirst({ where: { tenantId: ctx.business.id, userId, status: "active" }, include: { role: true, branches: { select: { branchId: true } } } }); }
  branchName(ctx: BusinessContext, id: string) { return db(ctx).branch.findUnique({ where: { id }, select: { name: true } }); }
  chatAccount(ctx: BusinessContext, externalId: string) { return db(ctx).channelAccount.findFirst({ where: { externalId, tenantId: ctx.business.id, active: true } }); }
  business(ctx: BusinessContext) { return db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id }, select: { name: true, phone: true, email: true } }); }
  me(ctx: BusinessContext) { return db(ctx).user.findUnique({ where: { id: ctx.member.userId }, select: { userName: true } }); }
}
