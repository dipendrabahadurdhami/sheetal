// The only code that reads and writes the agreements and agreement_signers tables for the business panel (KERNEL.md section 6).
// Where it fits: AgreementService calls it. The website API (website/backend/src/modules/sign) still reads and signs agreements by a signer's link; it is not
// moved (the signing rules and audit trail stay exactly as today).
// How it works: every read carries this business, "not deleted" and the branches in view (an agreement with no branch is outside a branch filter, as before).
// Writes that change a whole agreement and its signers are named methods here, each in the caller's transaction, each a compare-and-set on the status so a
// second click (or a signer signing at the same moment) can never apply twice. It also reads, never writes, the lease, lead and listing a draft is made from
// (manifest dependencies.reads).
// Rules: a DRAFT is really deleted (removeDraft), as before: nothing outside reads drafts, and a sent agreement is never deleted (cancel it instead).

import type { Prisma } from "@prisma/client";
import { actorIdOf, type BusinessContext, type DataScope } from "@sheetal/platform/core/context";
import { notFound } from "@sheetal/platform/core/errors";
import { BaseRepository } from "@sheetal/platform/core/repository";
import type { AgreementRow, Full, SignerRow } from "./types.js";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
const SIGNERS = { signers: { orderBy: { sort: "asc" as const } } };

export type NewSigner = Omit<Prisma.AgreementSignerUncheckedCreateInput, "agreementId">;

export class AgreementRepository extends BaseRepository<AgreementRow, never, never> {
  constructor() {
    super({
      model: "agreement", ownerField: "createdBy", label: "This agreement",
      filterable: { status: ["eq"], kind: ["eq"] }, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }],
    });
  }

  async listFull(ctx: BusinessContext, scope: DataScope): Promise<Full[]> {
    return (await db(ctx).agreement.findMany({ where: await this.scopeWhere(ctx, scope) as Prisma.AgreementWhereInput, orderBy: { createdAt: "desc" }, take: 1000, include: SIGNERS })) as Full[];
  }
  /** One agreement with its signers; "Agreement not found." when missing or out of view. */
  async full(ctx: BusinessContext, scope: DataScope, id: string): Promise<Full> {
    const a = await db(ctx).agreement.findFirst({ where: { AND: [await this.scopeWhere(ctx, scope) as Prisma.AgreementWhereInput, { id: id.slice(0, 40) }] }, include: SIGNERS });
    if (!a) throw notFound("Agreement not found.");
    return a as Full;
  }

  async createWithSigners(ctx: BusinessContext, data: Omit<Prisma.AgreementUncheckedCreateInput, "tenantId" | "signers">, signers: NewSigner[]): Promise<AgreementRow> {
    const me = actorIdOf(ctx);
    return (await db(ctx).agreement.create({ data: { ...data, tenantId: ctx.business.id, createdBy: me, updatedBy: me, version: 1, signers: { create: signers } } })) as AgreementRow;
  }

  /** Saves a draft: only while it is still a draft (and on `version` when one is given). False = it is no longer a draft, or someone saved first. */
  async saveDraft(ctx: BusinessContext, a: Full, data: Prisma.AgreementUpdateManyMutationInput, signers: (NewSigner & { id?: string })[], version?: number): Promise<boolean> {
    const t = db(ctx);
    const n = await t.agreement.updateMany({ where: { id: a.id, tenantId: ctx.business.id, status: "draft", ...(version !== undefined ? { version } : {}) }, data: { ...data, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } });
    if (!n.count) return false;
    const keep = new Set(signers.map((s) => s.id).filter(Boolean) as string[]);
    await t.agreementSigner.deleteMany({ where: { agreementId: a.id, id: { notIn: [...keep] } } });
    for (const s of signers) {
      const { id, ...row } = s;
      if (id && a.signers.some((x) => x.id === id)) await t.agreementSigner.update({ where: { id }, data: row });
      else await t.agreementSigner.create({ data: { ...row, agreementId: a.id } });
    }
    return true;
  }

  /** Draft -> sent with the frozen texts and their hash, and a new private link for each signer (only its hash is stored). */
  async markSent(ctx: BusinessContext, a: Full, texts: { en?: string; ne?: string }, hash: string, tokenHashes: Map<string, string>): Promise<boolean> {
    const t = db(ctx);
    const n = await t.agreement.updateMany({ where: { id: a.id, tenantId: ctx.business.id, status: "draft" }, data: { status: "sent", sentAt: new Date(), textEn: texts.en ?? null, textNe: texts.ne ?? null, hash, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } });
    if (!n.count) return false;
    for (const s of a.signers) await t.agreementSigner.update({ where: { id: s.id }, data: { tokenHash: tokenHashes.get(s.id)!, status: "pending", otpHash: null, otpSends: 0, otpTries: 0 } });
    return true;
  }

  /** A new private link for one signer who hasn't signed: the old link stops working. */
  async newLink(ctx: BusinessContext, signer: SignerRow, tokenHash: string): Promise<void> {
    await db(ctx).agreementSigner.update({ where: { id: signer.id }, data: { tokenHash, otpHash: null, otpSends: 0, otpTries: 0, otpSentAt: null } });
  }

  /** Sent or draft -> cancelled; the signers' codes stop working. False = it was signed or cancelled meanwhile. */
  async cancel(ctx: BusinessContext, a: Full, note: string): Promise<boolean> {
    const t = db(ctx);
    const n = await t.agreement.updateMany({ where: { id: a.id, tenantId: ctx.business.id, status: { in: ["draft", "sent"] } }, data: { status: "cancelled", cancelledAt: new Date(), cancelNote: note || null, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } });
    if (!n.count) return false;
    await t.agreementSigner.updateMany({ where: { agreementId: a.id }, data: { otpHash: null } });
    return true;
  }

  /** Really deletes a draft (its signers go with it). False = it is no longer a draft. */
  async removeDraft(ctx: BusinessContext, a: Full): Promise<boolean> {
    const n = await db(ctx).agreement.deleteMany({ where: { id: a.id, tenantId: ctx.business.id, status: "draft" } });
    return n.count > 0;
  }

  // ── What a draft is made from, and names (read only) ──

  async businessName(ctx: BusinessContext): Promise<string> {
    return (await db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id }, select: { name: true } })).name;
  }
  async me(ctx: BusinessContext): Promise<{ name: string; email: string }> {
    const u = await db(ctx).user.findUnique({ where: { id: ctx.member.userId }, select: { userName: true, email: true } });
    return { name: u?.userName ?? "", email: u?.email ?? "" };
  }
  private inView(ctx: BusinessContext, scope: DataScope) { const ids = ctx.branches.idsFor(scope); return ids ? { branchId: { in: [...ids] } } : {}; }
  lease(ctx: BusinessContext, scope: DataScope, id: string) {
    return db(ctx).rentLease.findFirst({ where: { id, tenantId: ctx.business.id, ...this.inView(ctx, scope) }, include: { unit: { include: { owner: true } } } });
  }
  lead(ctx: BusinessContext, scope: DataScope, id: string) {
    return db(ctx).lead.findFirst({ where: { id, tenantId: ctx.business.id, ...this.inView(ctx, scope) } });
  }
  listing(ctx: BusinessContext, id: number) {
    return db(ctx).listing.findFirst({ where: { id, tenantId: ctx.business.id } });
  }
}
