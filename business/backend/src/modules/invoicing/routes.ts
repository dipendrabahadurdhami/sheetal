// Customer invoices, credit notes and receipts: what a business bills its own customers (not Sheetal's plan bills,
// see modules/billing).
// Where it fits: Business → Customer invoices (Money.jsx), the "Invoice this stay" action of a booking, and the
// invoices import.
// How it works: a draft can be changed and has no number. Sending it gives the tax number (INV-2083-84-0001),
// counted per business and fiscal year, never reused, so cancelling keeps the number and the reason. Totals are
// worked out here (13% VAT on the subtotal, whole rupees), never taken from the browser. Payments are receipts
// (RC-…); a credit note (CN-…) reduces an invoice and is stored positive, sent negative. An invoice made from a
// booking carries its room bill (folio lines plus the 10% service charge) and picks up what the guest already paid
// at the front desk as receipts.
// Rules: invoices.view lists, invoices.create changes anything; every invoice belongs to one branch and people only
// see and change their branches' invoices; paid and cancelled money documents are never edited or deleted.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import { creditSplit, dayOf, docNo, fiscalYearOf, hotelBill, invoiceAmounts, nightsBetween, ymd, type InvoiceLine } from "@sheetal/backend-core/domain/money";
import { branchFor, branchView, inView, workspaceOf, type BranchView, type Workspace } from "../access.js";
import { bookingCode } from "../hotel/routes.js";

type Tx = Prisma.TransactionClient;
const WITH = { receipts: { orderBy: { createdAt: "asc" as const } } };
type Row = Prisma.BizInvoiceGetPayload<{ include: typeof WITH }>;

export const METHODS = ["cash", "fonepay", "esewa", "khalti", "card", "bank", "other"] as const;
const MAX = 2_000_000_000;
const DUE_DAYS = 10;

const label = (i: { no: string | null; seq: number }) => i.no ?? `DRAFT-${String(i.seq).padStart(4, "0")}`;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const addDays = (s: string, n: number) => { const d = dayOf(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const json = (v: unknown) => v as Prisma.InputJsonValue;
const rupees = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => ymd(dayOf(s)) === s, "That date doesn't exist.");
const Line = z.object({ what: z.string().trim().min(1, "Every line needs an item.").max(160), qty: z.number().int().min(1).max(99_999), rate: z.number().int().min(-100_000_000).max(100_000_000) });
const Vat = z.number().refine((v) => v === 0 || v === 13, "VAT is 13% or none.");
const Draft = z.object({
  to: z.string().trim().min(1, "Who is the invoice for?").max(120),
  phone: z.string().trim().max(30).nullish(),
  pan: z.string().trim().regex(/^\d{0,9}$/, "PAN is 9 digits.").nullish(),
  order: z.string().trim().max(40).nullish(),
  date: Day, due: Day, vatPct: Vat,
  notes: z.string().trim().max(1000).nullish(),
  lines: z.array(Line).min(1, "Add at least one line.").max(100),
  branchId: z.string().max(40).nullish(),
});
type DraftBody = z.infer<typeof Draft>;

const text = (max: number) => z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().max(max));
const opt = (max: number) => z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v == null ? undefined : String(v).trim() || undefined)).pipe(z.string().max(max).optional());
const num = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v === "" || v == null ? undefined : Number(v))).pipe(z.number().int().min(0).max(MAX).optional());
const ImportRow = z.object({ to: text(120).pipe(z.string().min(1, "Customer is missing.")), phone: opt(30), pan: opt(9), date: Day, item: text(160).pipe(z.string().min(1, "Item is missing.")), amount: num.refine((n) => !!n, "Amount is missing."), vat: num, paid: num });

/** The next number of a kind of document for a business and fiscal year, safe when two people save at once. */
async function nextNo(tx: Tx, tenantId: string, prefix: "INV" | "CN" | "RC", on: Date) {
  const fy = fiscalYearOf(on);
  const rows = await tx.$queryRaw<{ last: number }[]>`INSERT INTO doc_counters (tenant_id, key, last) VALUES (${tenantId}, ${`${prefix}:${fy}`}, 1) ON CONFLICT (tenant_id, key) DO UPDATE SET last = doc_counters.last + 1 RETURNING last`;
  return { fy, no: docNo(prefix, fy, rows[0]!.last) };
}
/** Holds one invoice for this transaction, so two payments or two sends can't both see the old balance. */
const lock = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM biz_invoices WHERE id = ${id} FOR UPDATE`;

function check(b: DraftBody) {
  if (b.due < b.date) throw badRequest("The due date is before the invoice date.");
  const a = invoiceAmounts(b.lines, b.vatPct);
  if (a.sub <= 0) throw badRequest("The invoice total must be more than zero.");
  if (a.total > MAX) throw badRequest("That total is too large.");
  return a;
}

export async function invoicingRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const canView = (ws: Workspace) => { if (!ws.can("invoicing.invoice.read") && !ws.can("invoicing.invoice.read+invoicing.invoice.create")) throw forbidden("Your role can't see invoices."); };
  const canWrite = (ws: Workspace) => { if (!ws.can("invoicing.invoice.read+invoicing.invoice.create")) throw forbidden("Your role can't create or change invoices."); };
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip } });

  function present(i: Row, names: Map<string, string>) {
    const credit = i.kind === "credit";
    const sign = credit ? -1 : 1;
    const paid = i.receipts.reduce((s, r) => s + r.amount, 0);
    return {
      id: i.id, no: i.no, label: label(i), kind: i.kind, status: i.status, to: i.toName, phone: i.toPhone ?? "", pan: i.toPan ?? "",
      order: i.order ?? "", bookingId: i.bookingId, date: day(i.issuedOn)!, due: day(i.dueOn)!, vatPct: i.vatPct, lines: i.lines as unknown as InvoiceLine[],
      notes: i.notes ?? "", reason: i.reason ?? "", creditFor: i.creditForId ? names.get(i.creditForId) ?? null : null, creditForId: i.creditForId, branchId: i.branchId,
      cancelReason: i.cancelReason ?? "", cancelledOn: day(i.cancelledAt), sentOn: day(i.sentAt),
      t: { sub: sign * i.subtotal, vat: sign * i.vat, total: sign * i.total, paid: credit ? 0 : paid, balance: credit || i.status === "cancelled" ? 0 : Math.max(0, i.total - paid) },
      receipts: i.receipts.map((r) => ({ id: r.id, no: r.no, at: day(r.paidOn)!, amount: r.amount, method: r.method, note: r.note ?? "" })),
    };
  }
  async function presentMany(rows: Row[]) {
    const names = new Map(rows.map((r) => [r.id, label(r)]));
    const missing = [...new Set(rows.map((r) => r.creditForId).filter((x): x is string => !!x && !names.has(x)))];
    if (missing.length) for (const o of await db().bizInvoice.findMany({ where: { id: { in: missing } }, select: { id: true, no: true, seq: true } })) names.set(o.id, label(o));
    return rows.map((r) => present(r, names));
  }
  const find = async (ws: Workspace, v: BranchView, id: string) => {
    const row = await db().bizInvoice.findFirst({ where: { id: id.slice(0, 40), tenantId: ws.tenantId, ...inView(v) }, include: WITH });
    if (!row) throw notFound("Invoice not found.");
    return row;
  };
  const one = async (ws: Workspace, v: BranchView, id: string) => (await presentMany([await find(ws, v, id)]))[0]!;

  /** A booking code typed as "Booking or order" is linked to the real booking; anything else stays as the person typed it. */
  async function linkOrder(ws: Workspace, v: BranchView, order?: string | null) {
    const o = order?.trim();
    if (!o) return { order: null, bookingId: null };
    const m = /^BK-?(\d+)$/i.exec(o);
    if (!m) return { order: o, bookingId: null };
    const b = await db().booking.findFirst({ where: { tenantId: ws.tenantId, seq: Number(m[1]), ...inView(v) }, select: { id: true, seq: true } });
    if (!b) throw badRequest(`There is no booking ${o.toUpperCase()} in your branches.`);
    return { order: bookingCode(b), bookingId: b.id };
  }

  /** A receipt for money received, numbered by the fiscal year of the payment date. */
  async function addReceipt(tx: Tx, tenantId: string, invoiceId: string, r: { amount: number; method: string; paidOn: Date; ref?: string; note?: string | null; by: string }) {
    const { no } = await nextNo(tx, tenantId, "RC", r.paidOn);
    return tx.bizReceipt.create({ data: { tenantId, invoiceId, no, amount: r.amount, method: r.method, paidOn: r.paidOn, ref: r.ref, note: r.note ?? null, createdBy: r.by } });
  }

  /** Draft → sent: gives the tax number, and for a booking's invoice counts what the guest already paid at the desk. */
  async function issue(tx: Tx, ws: Workspace, id: string) {
    await lock(tx, id);
    const inv = await tx.bizInvoice.findFirstOrThrow({ where: { id, tenantId: ws.tenantId } });
    if (inv.status !== "draft") throw badRequest("Only a draft can be sent.");
    if (inv.toPan && inv.toPan.length !== 9) throw badRequest("PAN is 9 digits. Fix it or leave it empty.");
    const { fy, no } = await nextNo(tx, ws.tenantId, inv.kind === "credit" ? "CN" : "INV", inv.issuedOn);
    await tx.bizInvoice.update({ where: { id }, data: { status: "sent", no, fy, sentAt: new Date() } });
    if (inv.bookingId && inv.kind === "invoice") {
      let left = inv.total;
      for (const p of await tx.guestPayment.findMany({ where: { bookingId: inv.bookingId }, orderBy: { createdAt: "asc" } })) {
        const amount = Math.min(p.amount, left);
        if (amount <= 0) continue;
        await addReceipt(tx, ws.tenantId, id, { amount, method: (METHODS as readonly string[]).includes(p.method) ? p.method : "other", paidOn: dayOf(ymd(p.createdAt)), ref: `gp:${p.id}`, note: "Paid at the front desk", by: ws.user.id });
        left -= amount;
      }
    }
    return no;
  }

  // ───── List ─────
  app.get("/invoices", async (request) => {
    const ws = workspaceOf(request); canView(ws);
    const v = await branchView(db(), request, ws);
    const rows = await db().bizInvoice.findMany({ where: { tenantId: ws.tenantId, ...inView(v) }, include: WITH, orderBy: [{ createdAt: "desc" }], take: 2000 });
    return { data: await presentMany(rows) };
  });

  // The rows of the Export button (same columns as the Import template: customer, date, item, amount before VAT, VAT %, paid).
  app.get("/invoices/rows", async (request) => {
    const ws = workspaceOf(request); canView(ws);
    const v = await branchView(db(), request, ws);
    const rows = await db().bizInvoice.findMany({ where: { tenantId: ws.tenantId, kind: "invoice", status: { not: "cancelled" }, ...inView(v) }, include: WITH, orderBy: { createdAt: "desc" }, take: 10_000 });
    return { data: rows.map((i) => ({ to: i.toName, phone: i.toPhone ?? "", pan: i.toPan ?? "", date: day(i.issuedOn), item: (i.lines as unknown as InvoiceLine[]).map((l) => (l.qty > 1 ? `${l.what} × ${l.qty}` : l.what)).join("; "), amount: i.subtotal, vat: i.vatPct, paid: i.receipts.reduce((x, r) => x + r.amount, 0) })) };
  });

  // ───── Create (a draft, or sent straight away) ─────
  app.post("/invoices", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = Draft.extend({ send: z.boolean().default(false) }).parse(request.body);
    const a = check(b);
    const v = await branchView(db(), request, ws);
    const branchId = branchFor(v, b.branchId);
    const link = await linkOrder(ws, v, b.order);
    const row = await db().$transaction(async (tx) => {
      const made = await tx.bizInvoice.create({ data: { tenantId: ws.tenantId, branchId, kind: "invoice", toName: b.to, toPhone: b.phone || null, toPan: b.pan || null, ...link, issuedOn: dayOf(b.date), dueOn: dayOf(b.due), vatPct: b.vatPct, lines: json(b.lines), subtotal: a.sub, vat: a.vat, total: a.total, notes: b.notes || null, createdBy: ws.user.id } });
      if (b.send) await issue(tx, ws, made.id);
      return tx.bizInvoice.findUniqueOrThrow({ where: { id: made.id }, include: WITH });
    });
    await audit(ws, request.ip, b.send ? "invoice.sent" : "invoice.draft", label(row));
    return { message: b.send ? `${label(row)} sent to ${b.to}.` : "Draft saved.", data: (await presentMany([row]))[0] };
  });

  // ───── Change or send a draft ─────
  app.put<{ Params: { id: string } }>("/invoices/:id", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = Draft.extend({ send: z.boolean().default(false) }).parse(request.body);
    const a = check(b);
    const v = await branchView(db(), request, ws);
    const cur = await find(ws, v, request.params.id);
    if (cur.status !== "draft") throw badRequest("Only a draft can be changed. Issue a credit note to correct a sent invoice.");
    const link = await linkOrder(ws, v, b.order);
    const row = await db().$transaction(async (tx) => {
      await tx.bizInvoice.update({ where: { id: cur.id }, data: { toName: b.to, toPhone: b.phone || null, toPan: b.pan || null, ...link, issuedOn: dayOf(b.date), dueOn: dayOf(b.due), vatPct: b.vatPct, lines: json(b.lines), subtotal: a.sub, vat: a.vat, total: a.total, notes: b.notes || null } });
      if (b.send) await issue(tx, ws, cur.id);
      return tx.bizInvoice.findUniqueOrThrow({ where: { id: cur.id }, include: WITH });
    });
    if (b.send) await audit(ws, request.ip, "invoice.sent", label(row));
    return { message: b.send ? `${label(row)} sent to ${b.to}.` : "Draft saved.", data: (await presentMany([row]))[0] };
  });

  app.post<{ Params: { id: string } }>("/invoices/:id/send", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const v = await branchView(db(), request, ws);
    const cur = await find(ws, v, request.params.id);
    if (cur.status === "draft" && !cur.toName.trim()) throw badRequest("Add who the invoice is for first.");
    await db().$transaction((tx) => issue(tx, ws, cur.id));
    const data = await one(ws, v, cur.id);
    await audit(ws, request.ip, "invoice.sent", data.label);
    return { message: `${data.label} sent to ${data.to}.`, data };
  });

  app.delete<{ Params: { id: string } }>("/invoices/:id", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const cur = await find(ws, await branchView(db(), request, ws), request.params.id);
    if (cur.status !== "draft") throw badRequest("Only a draft can be deleted. A sent invoice is cancelled, and stays in your records.");
    await db().bizInvoice.delete({ where: { id: cur.id } });
    await audit(ws, request.ip, "invoice.draft_deleted", label(cur));
    return { message: "Draft deleted." };
  });

  // ───── Payments (receipts) ─────
  app.post<{ Params: { id: string } }>("/invoices/:id/receipts", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = z.object({ amount: z.number().int().min(1).max(MAX), method: z.enum(METHODS), at: Day, note: z.string().trim().max(200).nullish() }).parse(request.body);
    const v = await branchView(db(), request, ws);
    const cur = await find(ws, v, request.params.id);
    const no = await db().$transaction(async (tx) => {
      await lock(tx, cur.id);
      const inv = await tx.bizInvoice.findFirstOrThrow({ where: { id: cur.id }, include: { receipts: true } });
      if (inv.kind !== "invoice" || inv.status !== "sent") throw badRequest("Only a sent invoice can be paid.");
      if (b.at < day(inv.issuedOn)!) throw badRequest("A payment can't be dated before the invoice.");
      const balance = inv.total - inv.receipts.reduce((s, r) => s + r.amount, 0);
      if (b.amount > balance) throw badRequest(balance > 0 ? `That is more than the balance of ${rupees(balance)}.` : "This invoice is already paid.");
      return (await addReceipt(tx, ws.tenantId, inv.id, { amount: b.amount, method: b.method, paidOn: dayOf(b.at), note: b.note, by: ws.user.id })).no;
    });
    await audit(ws, request.ip, "invoice.paid", `${label(cur)} ${no}`);
    return { message: `Payment recorded as ${no}.`, data: await one(ws, v, cur.id) };
  });

  // ───── Cancel (keeps the number and the reason) ─────
  app.post<{ Params: { id: string } }>("/invoices/:id/cancel", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = z.object({ reason: z.string().trim().min(1, "Give a reason.").max(200) }).parse(request.body);
    const v = await branchView(db(), request, ws);
    const cur = await find(ws, v, request.params.id);
    await db().$transaction(async (tx) => {
      await lock(tx, cur.id);
      const inv = await tx.bizInvoice.findFirstOrThrow({ where: { id: cur.id }, include: { receipts: true } });
      if (inv.status !== "sent") throw badRequest(inv.status === "draft" ? "A draft is deleted, not cancelled." : "It is already cancelled.");
      if (inv.receipts.length) throw badRequest("This has payments. Issue a credit note instead.");
      if (await tx.bizInvoice.count({ where: { creditForId: inv.id, status: { not: "cancelled" } } })) throw badRequest("This has a credit note. Cancel that first.");
      await tx.bizInvoice.update({ where: { id: inv.id }, data: { status: "cancelled", cancelReason: b.reason, cancelledAt: new Date() } });
    });
    await audit(ws, request.ip, "invoice.cancelled", label(cur));
    return { message: `${label(cur)} cancelled.`, data: await one(ws, v, cur.id) };
  });

  // ───── Credit note against a sent invoice ─────
  app.post<{ Params: { id: string } }>("/invoices/:id/credit", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = z.object({ amount: z.number().int().min(1).max(MAX), reason: z.string().trim().min(1, "Give a reason.").max(200), date: Day.optional() }).parse(request.body);
    const v = await branchView(db(), request, ws);
    const cur = await find(ws, v, request.params.id);
    const made = await db().$transaction(async (tx) => {
      await lock(tx, cur.id);
      const inv = await tx.bizInvoice.findFirstOrThrow({ where: { id: cur.id } });
      if (inv.kind !== "invoice" || inv.status !== "sent") throw badRequest("A credit note can only be issued against a sent invoice.");
      const already = (await tx.bizInvoice.aggregate({ where: { creditForId: inv.id, status: { not: "cancelled" } }, _sum: { total: true } }))._sum.total ?? 0;
      const room = inv.total - already;
      if (b.amount > room) throw badRequest(room > 0 ? `At most ${rupees(room)} can still be credited.` : "This invoice is already fully credited.");
      const s = creditSplit(b.amount, inv.vatPct);
      const on = dayOf(b.date ?? ymd(new Date()));
      const { fy, no } = await nextNo(tx, ws.tenantId, "CN", on);
      return tx.bizInvoice.create({ data: { tenantId: ws.tenantId, branchId: inv.branchId, kind: "credit", no, fy, creditForId: inv.id, status: "sent", toName: inv.toName, toPhone: inv.toPhone, toPan: inv.toPan, order: inv.order, bookingId: inv.bookingId, issuedOn: on, dueOn: on, vatPct: inv.vatPct, lines: json([{ what: `Credit against ${inv.no}: ${b.reason}`, qty: 1, rate: s.net }]), subtotal: s.net, vat: s.vat, total: s.total, reason: b.reason, sentAt: new Date(), createdBy: ws.user.id }, include: WITH });
    });
    await audit(ws, request.ip, "invoice.credit", `${made.no} for ${cur.no}`);
    return { message: `Credit note ${made.no} issued against ${cur.no}.`, data: (await presentMany([made]))[0] };
  });

  // ───── From a booking: the room bill as a draft invoice ─────
  app.post("/invoices/from-booking", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = z.object({ booking: z.string().trim().max(20), date: Day.optional() }).parse(request.body);
    const m = /^BK-?(\d+)$/i.exec(b.booking);
    if (!m) throw badRequest("Use a booking number like BK-0001.");
    const v = await branchView(db(), request, ws);
    const bk = await db().booking.findFirst({ where: { tenantId: ws.tenantId, seq: Number(m[1]), ...inView(v) }, include: { folio: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
    if (!bk) throw notFound(`There is no booking ${b.booking.toUpperCase()} in your branches.`);
    const have = await db().bizInvoice.findFirst({ where: { tenantId: ws.tenantId, bookingId: bk.id, kind: "invoice", status: { not: "cancelled" } } });
    if (have) throw conflict(`${bookingCode(bk)} already has ${label(have)}.`);
    const lines: InvoiceLine[] = bk.folio.map((f) => (f.qty > 0 && f.amount % f.qty === 0 ? { what: f.what, qty: f.qty, rate: f.amount / f.qty } : { what: f.what, qty: 1, rate: f.amount }));
    if (!lines.length) { const n = Math.max(1, nightsBetween(bk.checkIn, bk.checkOut)); lines.push({ what: `${bk.roomType}, ${n} night${n > 1 ? "s" : ""}`, qty: n, rate: bk.rate }); }
    const charges: { kind: string; amount: number }[] = bk.folio.length ? bk.folio : [{ kind: "room", amount: lines[0]!.qty * lines[0]!.rate }];
    const bill = hotelBill(charges.filter((f) => f.kind !== "discount").reduce((s, f) => s + f.amount, 0), -charges.filter((f) => f.kind === "discount").reduce((s, f) => s + f.amount, 0));
    if (bill.service > 0) lines.push({ what: "Service charge 10%", qty: 1, rate: bill.service });
    const date = b.date ?? ymd(new Date());
    const body = { to: bk.guestName, date, due: addDays(date, DUE_DAYS), vatPct: 13, lines } as DraftBody;
    const a = check(body);
    const branchId = bk.branchId ?? branchFor(v);
    const row = await db().bizInvoice.create({ data: { tenantId: ws.tenantId, branchId, kind: "invoice", toName: bk.guestName, toPhone: bk.phone, order: bookingCode(bk), bookingId: bk.id, issuedOn: dayOf(date), dueOn: dayOf(addDays(date, DUE_DAYS)), vatPct: 13, lines: json(lines), subtotal: a.sub, vat: a.vat, total: a.total, createdBy: ws.user.id }, include: WITH });
    await audit(ws, request.ip, "invoice.draft", `${label(row)} from ${bookingCode(bk)}`);
    return { message: `Draft ${label(row)} made from ${bookingCode(bk)}. Check it, then send.`, data: (await presentMany([row]))[0] };
  });

  // ───── Import (rows from the Import button; each row is sent, and counted paid when it says so) ─────
  app.post("/invoices/import", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const { rows } = z.object({ rows: z.array(ImportRow).min(1, "There are no rows to import.").max(500, "Import up to 500 invoices at a time.") }).parse(request.body);
    const v = await branchView(db(), request, ws);
    const branchId = branchFor(v);
    rows.forEach((r, i) => {
      if (r.vat !== undefined && r.vat !== 0 && r.vat !== 13) throw badRequest(`Row ${i + 1}: VAT is 13 or 0.`);
      const total = invoiceAmounts([{ what: r.item, qty: 1, rate: r.amount! }], r.vat ?? 13).total;
      if (total > MAX) throw badRequest(`Row ${i + 1}: the total is too large.`);
      if ((r.paid ?? 0) > total) throw badRequest(`Row ${i + 1}: paid is more than the invoice total.`);
    });
    await db().$transaction(async (tx) => {
      for (const r of rows) {
        const vatPct = r.vat ?? 13;
        const line: InvoiceLine = { what: r.item, qty: 1, rate: r.amount! };
        const a = invoiceAmounts([line], vatPct);
        const made = await tx.bizInvoice.create({ data: { tenantId: ws.tenantId, branchId, kind: "invoice", toName: r.to, toPhone: r.phone ?? null, toPan: r.pan && /^\d{9}$/.test(r.pan) ? r.pan : null, issuedOn: dayOf(r.date), dueOn: dayOf(addDays(r.date, DUE_DAYS)), vatPct, lines: json([line]), subtotal: a.sub, vat: a.vat, total: a.total, createdBy: ws.user.id } });
        await issue(tx, ws, made.id);
        if (r.paid) await addReceipt(tx, ws.tenantId, made.id, { amount: r.paid, method: "other", paidOn: dayOf(r.date), note: "Imported", by: ws.user.id });
      }
    }, { timeout: 60_000 });
    await audit(ws, request.ip, "invoice.import", `${rows.length} invoices`);
    return { message: `${rows.length} invoice${rows.length > 1 ? "s" : ""} imported.` };
  });
}
