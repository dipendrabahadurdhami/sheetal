// The rules of customer invoices, credit notes and receipts (what a business bills its own customers; not Sheetal's plan bills), on the kernel.
// Where it fits: InvoiceController calls one method per route. Moved from business/backend/src/modules/invoicing/routes.ts (P2-W3); every rule, message, number
// and audit string is unchanged.
// How it works: a draft can be changed and has no number. Sending gives the tax number (INV-2083-84-0001), counted per business and fiscal year and never
// reused, so cancelling keeps the number and the reason. Totals are worked out here (13% VAT on the subtotal, whole rupees), never taken from the browser.
// Payments are receipts (RC-…); a credit note (CN-…) reduces an invoice and is stored positive, sent negative. An invoice made from a hotel booking carries its
// room bill (folio lines plus the 10% service charge) and, when sent, picks up what the guest already paid at the front desk as receipts.
// Each change runs in ONE transaction with its audit line and its event.
// Rules: invoicing.invoice.read lists; read+create changes anything; every invoice belongs to one branch and people only see and change their branches'
// invoices; paid and cancelled money documents are never edited or deleted; a payment can't be more than the balance, a credit note not more than is left.

import { z } from "zod";
import { badRequest, conflict, forbidden, notFound, versionConflict } from "@sheetal/platform/core/errors";
import { monthStart, requireRoom } from "@sheetal/platform/billing/room";
import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseService } from "@sheetal/platform/core/service";
import { creditSplit, dayOf, hotelBill, invoiceAmounts, nightsBetween, ymd, type InvoiceLine } from "@sheetal/backend-core/domain/money";
import { INVOICE_EVENTS } from "./events.js";
import { InvoiceRepository } from "./invoice.repository.js";
import { bookingCode, day, exportRow, label, present, rupees } from "./presenter.js";
import { Cancel, Credit, DUE_DAYS, FromBooking, Import, MAX, METHODS, Receipt, Save, type DraftBody } from "./schemas.js";
import type { Full, InvoiceRow } from "./types.js";

export const READ = "invoicing.invoice.read";
export const WRITE = "invoicing.invoice.read+invoicing.invoice.create";
const json = (v: unknown) => v as never;
const addDays = (s: string, n: number) => { const d = dayOf(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

function check(b: DraftBody) {
  if (b.due < b.date) throw badRequest("The due date is before the invoice date.");
  const a = invoiceAmounts(b.lines, b.vatPct);
  if (a.sub <= 0) throw badRequest("The invoice total must be more than zero.");
  if (a.total > MAX) throw badRequest("That total is too large.");
  return a;
}

export class InvoiceService extends BaseService<InvoiceRow, never, never> {
  readonly invoices = new InvoiceRepository();
  constructor(deps: { bus: EventBus }) {
    super({
      app: "invoicing", resource: "invoice", repo: new InvoiceRepository(),
      permissions: { read: READ, create: WRITE, update: WRITE, delete: WRITE },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "invoice", label },
      bus: deps.bus, requireVersion: false,
    });
  }

  private canView(ctx: BusinessContext): DataScope {
    if (!ctx.permissions.can(READ) && !ctx.permissions.can(WRITE)) throw forbidden("Your role can't see invoices.");
    return "branch";
  }
  private canWrite(ctx: BusinessContext): DataScope {
    if (!ctx.permissions.can(WRITE)) throw forbidden("Your role can't create or change invoices.");
    return "branch";
  }
  /** One change: the transaction, then its audit line (when the old code wrote one) and its event, all together. */
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => { audit?: { action: string; target: string }; event: { name: string; payload: object; branchId?: string | null } }, opts?: { timeout?: number }): Promise<R> {
    this.refuseReadOnly(ctx);
    this.requireApp(ctx);
    const go = async (tx: BusinessContext) => {
      const r = await run(tx);
      const a = after(r);
      if (a.audit) await this.writeAudit(tx, a.audit.action, a.audit.target);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1, { branchId: a.event.branchId ?? null });
      return r;
    };
    if (!opts?.timeout) return this.inTransaction(ctx, go);
    // A long import gets more time; the same steps as inTransaction().
    return (ctx.db as unknown as { $transaction<T>(f: (tx: unknown) => Promise<T>, o: object): Promise<T> }).$transaction((tx) => go({ ...ctx, tx: tx as never }), { timeout: opts.timeout });
  }

  async presentMany(ctx: BusinessContext, rows: Full[]) {
    const names = new Map(rows.map((r) => [r.id, label(r)]));
    const missing = [...new Set(rows.map((r) => r.creditForId).filter((x): x is string => !!x && !names.has(x)))];
    for (const o of await this.invoices.labelsOf(ctx, missing)) names.set(o.id, label(o));
    return rows.map((r) => present(r, names));
  }
  private async one(ctx: BusinessContext, scope: DataScope, id: string) { return (await this.presentMany(ctx, [await this.invoices.full(ctx, scope, id)]))[0]!; }

  /** A booking code typed as "Booking or order" is linked to the real booking; anything else stays as the person typed it. */
  private async linkOrder(ctx: BusinessContext, scope: DataScope, order?: string | null) {
    const o = order?.trim();
    if (!o) return { order: null, bookingId: null };
    const m = /^BK-?(\d+)$/i.exec(o);
    if (!m) return { order: o, bookingId: null };
    const b = await this.invoices.bookingId(ctx, scope, Number(m[1]));
    if (!b) throw badRequest(`There is no booking ${o.toUpperCase()} in your branches.`);
    return { order: bookingCode(b), bookingId: b.id };
  }

  /** Draft → sent: gives the tax number, and for a booking's invoice counts what the guest already paid at the desk. */
  private async issue(tx: BusinessContext, id: string): Promise<string> {
    await this.invoices.lock(tx, id);
    const inv = await this.invoices.current(tx, id);
    if (inv.status !== "draft") throw badRequest("Only a draft can be sent.");
    if (inv.toPan && inv.toPan.length !== 9) throw badRequest("PAN is 9 digits. Fix it or leave it empty.");
    const { fy, no } = await this.invoices.nextNo(tx, inv.kind === "credit" ? "CN" : "INV", inv.issuedOn);
    await this.invoices.change(tx, id, { status: "sent", no, fy, sentAt: new Date() });
    if (inv.bookingId && inv.kind === "invoice") {
      let left = inv.total;
      for (const p of await this.invoices.guestPayments(tx, inv.bookingId)) {
        const amount = Math.min(p.amount, left);
        if (amount <= 0) continue;
        await this.invoices.addReceipt(tx, id, { amount, method: (METHODS as readonly string[]).includes(p.method) ? p.method : "other", paidOn: dayOf(ymd(p.createdAt)), ref: `gp:${p.id}`, note: "Paid at the front desk" });
        left -= amount;
      }
    }
    return no;
  }

  // ───── Read ─────

  async all(ctx: BusinessContext) { return this.presentMany(ctx, await this.invoices.listFull(ctx, this.canView(ctx))); }
  async rows(ctx: BusinessContext) {
    return (await this.invoices.listFull(ctx, this.canView(ctx), { kind: "invoice", status: { not: "cancelled" } }, 10_000)).map(exportRow);
  }

  // ───── Create, change, send, delete ─────

  async make(ctx: BusinessContext, raw: unknown) {
    const scope = this.canWrite(ctx);
    const { version: _v, ...b } = Save.parse(raw);
    void _v;
    const a = check(b);
    const branchId = ctx.branches.branchForNew(b.branchId);
    const link = await this.linkOrder(ctx, scope, b.order);
    // On app subscriptions: the Invoicing edition's invoices a month (free 20; a soft limit: 20% over is allowed before it stops).
    await requireRoom(ctx, "invoicing", "invoices_per_month", () => ctx.db.bizInvoice.count({ where: { tenantId: ctx.business.id, deletedAt: null, kind: "invoice", createdAt: { gte: monthStart(ctx.now) } } }));
    const row = await this.write(ctx, async (tx) => {
      const made = await this.invoices.make(tx, { branchId, kind: "invoice", toName: b.to, toPhone: b.phone || null, toPan: b.pan || null, ...link, issuedOn: dayOf(b.date), dueOn: dayOf(b.due), vatPct: b.vatPct, lines: json(b.lines), subtotal: a.sub, vat: a.vat, total: a.total, notes: b.notes || null });
      if (b.send) await this.issue(tx, made.id);
      return this.invoices.current(tx, made.id);
    }, (r) => ({ audit: { action: b.send ? "invoice.sent" : "invoice.draft", target: label(r) }, event: { name: b.send ? INVOICE_EVENTS.sent : INVOICE_EVENTS.drafted, payload: { id: r.id, no: r.no, total: r.total }, branchId: r.branchId } }));
    return { message: b.send ? `${label(row)} sent to ${b.to}.` : "Draft saved.", data: (await this.presentMany(ctx, [row]))[0] };
  }

  async save(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.canWrite(ctx);
    const { version, ...b } = Save.parse(raw);
    const a = check(b);
    const cur = await this.invoices.full(ctx, scope, id);
    if (cur.status !== "draft") throw badRequest("Only a draft can be changed. Issue a credit note to correct a sent invoice.");
    if (version !== undefined && version !== cur.version) throw versionConflict("This invoice");
    const link = await this.linkOrder(ctx, scope, b.order);
    const row = await this.write(ctx, async (tx) => {
      await this.invoices.lock(tx, cur.id);
      const now = await this.invoices.current(tx, cur.id);
      if (now.status !== "draft") throw badRequest("Only a draft can be changed. Issue a credit note to correct a sent invoice.");
      if (version !== undefined && version !== now.version) throw versionConflict("This invoice");
      await this.invoices.change(tx, cur.id, { toName: b.to, toPhone: b.phone || null, toPan: b.pan || null, ...link, issuedOn: dayOf(b.date), dueOn: dayOf(b.due), vatPct: b.vatPct, lines: json(b.lines), subtotal: a.sub, vat: a.vat, total: a.total, notes: b.notes || null });
      if (b.send) await this.issue(tx, cur.id);
      return this.invoices.current(tx, cur.id);
    }, (r) => ({ ...(b.send ? { audit: { action: "invoice.sent", target: label(r) } } : {}), event: { name: b.send ? INVOICE_EVENTS.sent : INVOICE_EVENTS.drafted, payload: { id: r.id, no: r.no, total: r.total }, branchId: r.branchId } }));
    return { message: b.send ? `${label(row)} sent to ${b.to}.` : "Draft saved.", data: (await this.presentMany(ctx, [row]))[0] };
  }

  async send(ctx: BusinessContext, id: string) {
    const scope = this.canWrite(ctx);
    const cur = await this.invoices.full(ctx, scope, id);
    if (cur.status === "draft" && !cur.toName.trim()) throw badRequest("Add who the invoice is for first.");
    const no = await this.write(ctx, (tx) => this.issue(tx, cur.id), (n) => ({ audit: { action: "invoice.sent", target: n }, event: { name: INVOICE_EVENTS.sent, payload: { id: cur.id, no: n, total: cur.total }, branchId: cur.branchId } }));
    const data = await this.one(ctx, scope, cur.id);
    void no;
    return { message: `${data.label} sent to ${data.to}.`, data };
  }

  async removeDraft(ctx: BusinessContext, id: string) {
    const scope = this.canWrite(ctx);
    const cur = await this.invoices.full(ctx, scope, id);
    if (cur.status !== "draft") throw badRequest("Only a draft can be deleted. A sent invoice is cancelled, and stays in your records.");
    await this.write(ctx, async (tx) => { if (!(await this.invoices.removeDraft(tx, cur.id))) throw badRequest("Only a draft can be deleted. A sent invoice is cancelled, and stays in your records."); return cur; },
      () => ({ audit: { action: "invoice.draft_deleted", target: label(cur) }, event: { name: INVOICE_EVENTS.deleted, payload: { id: cur.id }, branchId: cur.branchId } }));
    return { message: "Draft deleted." };
  }

  // ───── Payments, cancel, credit notes ─────

  async pay(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.canWrite(ctx);
    const b = Receipt.parse(raw);
    const cur = await this.invoices.full(ctx, scope, id);
    const no = await this.write(ctx, async (tx) => {
      await this.invoices.lock(tx, cur.id);
      const inv = await this.invoices.current(tx, cur.id);
      if (inv.kind !== "invoice" || inv.status !== "sent") throw badRequest("Only a sent invoice can be paid.");
      if (b.at < day(inv.issuedOn)!) throw badRequest("A payment can't be dated before the invoice.");
      const balance = inv.total - inv.receipts.reduce((s, r) => s + r.amount, 0);
      if (b.amount > balance) throw badRequest(balance > 0 ? `That is more than the balance of ${rupees(balance)}.` : "This invoice is already paid.");
      return (await this.invoices.addReceipt(tx, inv.id, { amount: b.amount, method: b.method, paidOn: dayOf(b.at), note: b.note })).no;
    }, (n) => ({ audit: { action: "invoice.paid", target: `${label(cur)} ${n}` }, event: { name: INVOICE_EVENTS.paid, payload: { id: cur.id, receipt: n, amount: b.amount }, branchId: cur.branchId } }));
    return { message: `Payment recorded as ${no}.`, data: await this.one(ctx, scope, cur.id) };
  }

  async cancel(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.canWrite(ctx);
    const b = Cancel.parse(raw);
    const cur = await this.invoices.full(ctx, scope, id);
    await this.write(ctx, async (tx) => {
      await this.invoices.lock(tx, cur.id);
      const inv = await this.invoices.current(tx, cur.id);
      if (inv.status !== "sent") throw badRequest(inv.status === "draft" ? "A draft is deleted, not cancelled." : "It is already cancelled.");
      if (inv.receipts.length) throw badRequest("This has payments. Issue a credit note instead.");
      if ((await this.invoices.credits(tx, inv.id)).count) throw badRequest("This has a credit note. Cancel that first.");
      await this.invoices.change(tx, inv.id, { status: "cancelled", cancelReason: b.reason, cancelledAt: new Date() });
      return inv;
    }, () => ({ audit: { action: "invoice.cancelled", target: label(cur) }, event: { name: INVOICE_EVENTS.cancelled, payload: { id: cur.id, no: cur.no }, branchId: cur.branchId } }));
    return { message: `${label(cur)} cancelled.`, data: await this.one(ctx, scope, cur.id) };
  }

  async credit(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.canWrite(ctx);
    const b = Credit.parse(raw);
    const cur = await this.invoices.full(ctx, scope, id);
    const made = await this.write(ctx, async (tx) => {
      await this.invoices.lock(tx, cur.id);
      const inv = await this.invoices.current(tx, cur.id);
      if (inv.kind !== "invoice" || inv.status !== "sent") throw badRequest("A credit note can only be issued against a sent invoice.");
      const room = inv.total - (await this.invoices.credits(tx, inv.id)).total;
      if (b.amount > room) throw badRequest(room > 0 ? `At most ${rupees(room)} can still be credited.` : "This invoice is already fully credited.");
      const s = creditSplit(b.amount, inv.vatPct);
      const on = dayOf(b.date ?? ymd(new Date()));
      const { fy, no } = await this.invoices.nextNo(tx, "CN", on);
      return this.invoices.make(tx, { branchId: inv.branchId, kind: "credit", no, fy, creditForId: inv.id, status: "sent", toName: inv.toName, toPhone: inv.toPhone, toPan: inv.toPan, order: inv.order, bookingId: inv.bookingId, issuedOn: on, dueOn: on, vatPct: inv.vatPct, lines: json([{ what: `Credit against ${inv.no}: ${b.reason}`, qty: 1, rate: s.net }]), subtotal: s.net, vat: s.vat, total: s.total, reason: b.reason, sentAt: new Date() });
    }, (m) => ({ audit: { action: "invoice.credit", target: `${m.no} for ${cur.no}` }, event: { name: INVOICE_EVENTS.credited, payload: { id: m.id, no: m.no, invoiceId: cur.id, total: m.total }, branchId: m.branchId } }));
    return { message: `Credit note ${made.no} issued against ${cur.no}.`, data: (await this.presentMany(ctx, [made]))[0] };
  }

  // ───── From a hotel booking, and the import ─────

  async fromBooking(ctx: BusinessContext, raw: unknown) {
    const scope = this.canWrite(ctx);
    const b = FromBooking.parse(raw);
    const m = /^BK-?(\d+)$/i.exec(b.booking);
    if (!m) throw badRequest("Use a booking number like BK-0001.");
    const bk = await this.invoices.booking(ctx, scope, Number(m[1]));
    if (!bk) throw notFound(`There is no booking ${b.booking.toUpperCase()} in your branches.`);
    const have = await this.invoices.forBooking(ctx, bk.id);
    if (have) throw conflict(`${bookingCode(bk)} already has ${label(have)}.`);
    const lines: InvoiceLine[] = bk.folio.map((f) => (f.qty > 0 && f.amount % f.qty === 0 ? { what: f.what, qty: f.qty, rate: f.amount / f.qty } : { what: f.what, qty: 1, rate: f.amount }));
    if (!lines.length) { const n = Math.max(1, nightsBetween(bk.checkIn, bk.checkOut)); lines.push({ what: `${bk.roomType}, ${n} night${n > 1 ? "s" : ""}`, qty: n, rate: bk.rate }); }
    const charges: { kind: string; amount: number }[] = bk.folio.length ? bk.folio : [{ kind: "room", amount: lines[0]!.qty * lines[0]!.rate }];
    const bill = hotelBill(charges.filter((f) => f.kind !== "discount").reduce((s, f) => s + f.amount, 0), -charges.filter((f) => f.kind === "discount").reduce((s, f) => s + f.amount, 0));
    if (bill.service > 0) lines.push({ what: "Service charge 10%", qty: 1, rate: bill.service });
    const date = b.date ?? ymd(new Date());
    const a = check({ to: bk.guestName, date, due: addDays(date, DUE_DAYS), vatPct: 13, lines } as DraftBody);
    const branchId = bk.branchId ?? ctx.branches.branchForNew();
    const row = await this.write(ctx, (tx) => this.invoices.make(tx, { branchId, kind: "invoice", toName: bk.guestName, toPhone: bk.phone, order: bookingCode(bk), bookingId: bk.id, issuedOn: dayOf(date), dueOn: dayOf(addDays(date, DUE_DAYS)), vatPct: 13, lines: json(lines), subtotal: a.sub, vat: a.vat, total: a.total }),
      (r) => ({ audit: { action: "invoice.draft", target: `${label(r)} from ${bookingCode(bk)}` }, event: { name: INVOICE_EVENTS.drafted, payload: { id: r.id, no: null, total: r.total }, branchId: r.branchId } }));
    return { message: `Draft ${label(row)} made from ${bookingCode(bk)}. Check it, then send.`, data: (await this.presentMany(ctx, [row]))[0] };
  }

  async importRows(ctx: BusinessContext, raw: unknown) {
    this.canWrite(ctx);
    const { rows } = Import.parse(raw);
    const branchId = ctx.branches.branchForNew();
    rows.forEach((r, i) => {
      if (r.vat !== undefined && r.vat !== 0 && r.vat !== 13) throw badRequest(`Row ${i + 1}: VAT is 13 or 0.`);
      const total = invoiceAmounts([{ what: r.item, qty: 1, rate: r.amount! }], r.vat ?? 13).total;
      if (total > MAX) throw badRequest(`Row ${i + 1}: the total is too large.`);
      if ((r.paid ?? 0) > total) throw badRequest(`Row ${i + 1}: paid is more than the invoice total.`);
    });
    await this.write(ctx, async (tx) => {
      for (const r of rows) {
        const vatPct = r.vat ?? 13;
        const line: InvoiceLine = { what: r.item, qty: 1, rate: r.amount! };
        const a = invoiceAmounts([line], vatPct);
        const made = await this.invoices.make(tx, { branchId, kind: "invoice", toName: r.to, toPhone: r.phone ?? null, toPan: r.pan && /^\d{9}$/.test(r.pan) ? r.pan : null, issuedOn: dayOf(r.date), dueOn: dayOf(addDays(r.date, DUE_DAYS)), vatPct, lines: json([line]), subtotal: a.sub, vat: a.vat, total: a.total });
        await this.issue(tx, made.id);
        if (r.paid) await this.invoices.addReceipt(tx, made.id, { amount: r.paid, method: "other", paidOn: dayOf(r.date), note: "Imported" });
      }
      return rows.length;
    }, (n) => ({ audit: { action: "invoice.import", target: `${n} invoices` }, event: { name: INVOICE_EVENTS.imported, payload: { count: n }, branchId } }), { timeout: 60_000 });
    return { message: `${rows.length} invoice${rows.length > 1 ? "s" : ""} imported.` };
  }
}
