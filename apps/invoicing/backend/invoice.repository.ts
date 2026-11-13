// The only code that reads and writes customer invoices, credit notes and receipts (KERNEL.md section 6), and that counts their tax numbers.
// Where it fits: InvoiceService calls it, always inside its transaction for a change.
// How it works: every invoice belongs to one branch; reads carry this business, "not deleted" and the branches in view. lock() holds one invoice row for the
// transaction (SELECT … FOR UPDATE), so two payments or two sends can't both see the old balance. nextNo() counts INV / CN / RC numbers per business and
// fiscal year in doc_counters with one INSERT … ON CONFLICT, so two people saving at once never get the same number and a number is never reused.
// It also reads, never writes, the Hotel app's bookings, room bills and front-desk payments (manifest dependencies.reads).
// Rules: a DRAFT is really deleted (it has no number); a sent or cancelled document is never edited or deleted.

import type { Prisma } from "@prisma/client";
import { actorIdOf, type BusinessContext, type DataScope } from "@sheetal/platform/core/context";
import { notFound } from "@sheetal/platform/core/errors";
import { BaseRepository } from "@sheetal/platform/core/repository";
import { docNo, fiscalYearOf } from "@sheetal/backend-core/domain/money";
import type { Full, InvoiceRow } from "./types.js";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
export const WITH = { receipts: { orderBy: { createdAt: "asc" as const } } };

export class InvoiceRepository extends BaseRepository<InvoiceRow, never, never> {
  constructor() {
    super({ model: "bizInvoice", ownerField: "createdBy", label: "This invoice", filterable: { status: ["eq"], kind: ["eq"] }, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] });
  }
  private async scoped(ctx: BusinessContext, scope: DataScope, more: Prisma.BizInvoiceWhereInput = {}): Promise<Prisma.BizInvoiceWhereInput> {
    return { AND: [(await this.scopeWhere(ctx, scope)) as Prisma.BizInvoiceWhereInput, more] };
  }
  async listFull(ctx: BusinessContext, scope: DataScope, more: Prisma.BizInvoiceWhereInput = {}, take = 2000): Promise<Full[]> {
    return (await db(ctx).bizInvoice.findMany({ where: await this.scoped(ctx, scope, more), include: WITH, orderBy: [{ createdAt: "desc" }], take })) as Full[];
  }
  /** One invoice in view with its receipts, or "Invoice not found.". */
  async full(ctx: BusinessContext, scope: DataScope, id: string): Promise<Full> {
    const row = await db(ctx).bizInvoice.findFirst({ where: await this.scoped(ctx, scope, { id: id.slice(0, 40) }), include: WITH });
    if (!row) throw notFound("Invoice not found.");
    return row as Full;
  }
  /** The labels of invoices (by id) a credit note points to, wherever they are (a name only, never their contents). */
  async labelsOf(ctx: BusinessContext, ids: string[]): Promise<{ id: string; no: string | null; seq: number }[]> {
    return ids.length ? db(ctx).bizInvoice.findMany({ where: { id: { in: ids }, tenantId: ctx.business.id }, select: { id: true, no: true, seq: true } }) : [];
  }

  // ── Inside a transaction ──

  async lock(ctx: BusinessContext, id: string): Promise<void> { await db(ctx).$queryRaw`SELECT id FROM biz_invoices WHERE id = ${id} FOR UPDATE`; }
  async nextNo(ctx: BusinessContext, prefix: "INV" | "CN" | "RC", on: Date): Promise<{ fy: string; no: string }> {
    const fy = fiscalYearOf(on);
    const rows = await db(ctx).$queryRaw<{ last: number }[]>`INSERT INTO doc_counters (tenant_id, key, last) VALUES (${ctx.business.id}, ${`${prefix}:${fy}`}, 1) ON CONFLICT (tenant_id, key) DO UPDATE SET last = doc_counters.last + 1 RETURNING last`;
    return { fy, no: docNo(prefix, fy, rows[0]!.last) };
  }
  /** The invoice as it is now (after lock()), with its receipts. */
  async current(ctx: BusinessContext, id: string): Promise<Full> {
    return (await db(ctx).bizInvoice.findFirstOrThrow({ where: { id, tenantId: ctx.business.id }, include: WITH })) as Full;
  }
  async make(ctx: BusinessContext, data: Omit<Prisma.BizInvoiceUncheckedCreateInput, "tenantId">): Promise<Full> {
    const me = actorIdOf(ctx);
    return (await db(ctx).bizInvoice.create({ data: { ...data, tenantId: ctx.business.id, createdBy: me, updatedBy: me }, include: WITH })) as Full;
  }
  async change(ctx: BusinessContext, id: string, data: Prisma.BizInvoiceUncheckedUpdateInput): Promise<void> {
    await db(ctx).bizInvoice.update({ where: { id }, data: { ...data, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } });
  }
  async removeDraft(ctx: BusinessContext, id: string): Promise<boolean> {
    return (await db(ctx).bizInvoice.deleteMany({ where: { id, tenantId: ctx.business.id, status: "draft" } })).count > 0;
  }
  /** Credit notes against an invoice that aren't cancelled: how many, and their total. */
  async credits(ctx: BusinessContext, invoiceId: string): Promise<{ count: number; total: number }> {
    const r = await db(ctx).bizInvoice.aggregate({ where: { creditForId: invoiceId, tenantId: ctx.business.id, status: { not: "cancelled" } }, _sum: { total: true }, _count: true });
    return { count: r._count, total: r._sum.total ?? 0 };
  }
  async addReceipt(ctx: BusinessContext, invoiceId: string, r: { amount: number; method: string; paidOn: Date; ref?: string; note?: string | null }) {
    const { no } = await this.nextNo(ctx, "RC", r.paidOn);
    const me = actorIdOf(ctx);
    return db(ctx).bizReceipt.create({ data: { tenantId: ctx.business.id, invoiceId, no, amount: r.amount, method: r.method, paidOn: r.paidOn, ref: r.ref, note: r.note ?? null, createdBy: me, updatedBy: me } });
  }
  /** An invoice that isn't cancelled already made for this booking. */
  forBooking(ctx: BusinessContext, bookingId: string) {
    return db(ctx).bizInvoice.findFirst({ where: { tenantId: ctx.business.id, bookingId, kind: "invoice", status: { not: "cancelled" }, deletedAt: null } });
  }

  // ── Read only: the Hotel app's bookings ──

  private async inView(ctx: BusinessContext, scope: DataScope) { const ids = ctx.branches.idsFor(scope); return ids ? { branchId: { in: [...ids] } } : {}; }
  async booking(ctx: BusinessContext, scope: DataScope, seq: number) {
    return db(ctx).booking.findFirst({ where: { tenantId: ctx.business.id, seq, ...(await this.inView(ctx, scope)) }, include: { folio: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  }
  async bookingId(ctx: BusinessContext, scope: DataScope, seq: number) {
    return db(ctx).booking.findFirst({ where: { tenantId: ctx.business.id, seq, ...(await this.inView(ctx, scope)) }, select: { id: true, seq: true } });
  }
  guestPayments(ctx: BusinessContext, bookingId: string) {
    return db(ctx).guestPayment.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });
  }
}
