// Rentals: owners (landlords), units, leases, monthly rent bills, rent payments, repairs and owner statements.
// Where it fits: Business → Rentals (LiveRentals.jsx), for agencies that manage homes and shops for owners.
// How it works: an owner has units; a unit has at most one active lease; every active lease gets one rent bill a
// month (a background job, and the page when it opens, make them, and add a late fee once when a bill is still unpaid
// the set days after its due date). Staff record payments against a bill. Repairs belong to a unit and, when done,
// come off the owner's statement. An owner statement for a month is rent collected − management fee − repairs; saving
// it counts the fee in the agency's profit (Business → Expenses → Profit). See backend-core/src/domain/rentals.ts.
// Rules: rentals.view reads; rentals.manage changes anything; everything belongs to a branch and people only see their
// branches'; a payment can't be more than what is owed; online payments count once confirmed (see domain/rentpay.ts); a bill's amount can only change before anything is paid;
// rent is the owner's money, never the agency's income, and a deposit is held and returned, never income.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { MAX_RENT, RENT_METHODS, UNIT_KINDS, balanceOf, billNo, billStatus, leaseCovers, leaseNo, repairNo, runRentBills, statementsFor } from "@sheetal/backend-core/domain/rentals";
import { confirmRentPayment, rejectRentPayment } from "@sheetal/backend-core/domain/rentpay";
import { readPrivateFile } from "@sheetal/backend-core/lib/files";
import { branchFor, branchView, inView, workspaceOf, type BranchView, type Workspace } from "../access.js";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11.");
const Rupees = z.number().int("Use whole rupees.").min(0).max(MAX_RENT);
const Text = (max: number) => z.string().trim().max(max).nullish();
const Pct = (max: number) => z.number().min(0).max(max);
const bp = (pct: number) => Math.round(pct * 100);

const OwnerBody = z.object({ name: z.string().trim().min(1, "Write the owner's name.").max(120), phone: Text(30), email: Text(120), feePct: Pct(50).default(8), bank: Text(160), note: Text(300), branchId: z.string().max(40).nullish() });
const UnitBody = z.object({ ownerId: z.string().min(1, "Choose the owner.").max(40), property: z.string().trim().min(1, "Write the building or house name.").max(120), name: z.string().trim().min(1, "Write the unit name.").max(80), kind: z.enum(UNIT_KINDS).default("Flat"), rent: Rupees, status: z.enum(["vacant", "repair"]).optional(), listingId: z.number().int().positive().nullish() });
const LeaseTerms = { renter: z.string().trim().min(1, "Write the tenant's name.").max(120), phone: Text(30), email: Text(120), rent: Rupees.refine((n) => n > 0, "Write the monthly rent."), dueDay: z.number().int().min(1, "Choose a day from 1 to 28.").max(28, "Choose a day from 1 to 28.").default(7), lateFeePct: Pct(20).default(2), lateAfterDays: z.number().int().min(0).max(60).default(5) };
const LeaseBody = z.object({ unitId: z.string().min(1).max(40), start: Day, end: Day, deposit: Rupees.default(0), ...LeaseTerms });
const LeaseChange = z.object({ end: Day, ...LeaseTerms });
const RepairBody = z.object({ title: z.string().trim().min(1, "Say what needs fixing.").max(160), priority: z.enum(["urgent", "normal", "low"]).default("normal"), vendor: Text(120), cost: Rupees.default(0), status: z.enum(["open", "assigned", "done"]).default("open"), doneOn: Day.nullish() });

export async function rentalRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const canView = (ws: Workspace) => { if (!ws.can("rentals.view") && !ws.can("rentals.manage")) throw forbidden("Your role can't see rentals."); };
  const canWrite = (ws: Workspace) => { if (!ws.can("rentals.manage")) throw forbidden("Your role can't change rentals."); };
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip } });
  const names = (v: BranchView) => new Map(v.mine.map((b) => [b.id, b.name]));
  const start = async (request: FastifyRequest, write = false) => {
    const ws = workspaceOf(request);
    if (write) canWrite(ws); else canView(ws);
    return { ws, v: await branchView(db(), request, ws) };
  };
  const one = async <T>(found: T | null, what: string) => { if (!found) throw notFound(`${what} not found.`); return found; };
  const where = (ws: Workspace, v: BranchView, id: string) => ({ id: id.slice(0, 40), tenantId: ws.tenantId, ...inView(v) });

  // ───── The page: everything at once (a business manages tens or hundreds of units, not thousands) ─────
  app.get("/rentals", async (request) => {
    const { ws, v } = await start(request);
    const today = nepalDay();
    await runRentBills(db(), { today, tenantId: ws.tenantId });
    const scope = { tenantId: ws.tenantId, ...inView(v) };
    const [owners, units, leases, bills, repairs] = await Promise.all([
      db().rentOwner.findMany({ where: scope, orderBy: { name: "asc" } }),
      db().rentUnit.findMany({ where: scope, orderBy: [{ property: "asc" }, { name: "asc" }] }),
      db().rentLease.findMany({ where: scope, orderBy: [{ status: "asc" }, { endOn: "asc" }], take: 2000 }),
      db().rentBill.findMany({ where: scope, orderBy: [{ month: "desc" }, { seq: "desc" }], take: 3000 }),
      db().rentRepair.findMany({ where: scope, orderBy: [{ createdAt: "desc" }], take: 1000 }),
    ]);
    const [pending, listings] = await Promise.all([
      db().rentPayment.findMany({ where: { ...scope, status: "pending" }, orderBy: { createdAt: "asc" }, take: 500, include: { bill: { select: { seq: true, month: true, leaseId: true } } } }),
      db().listing.findMany({ where: { tenantId: ws.tenantId, status: { not: "removed" } }, orderBy: { id: "desc" }, take: 1000, select: { id: true, code: true, title: true } }),
    ]);
    const codes = new Map(listings.map((l) => [l.id, l.code]));
    const br = names(v);
    const owner = new Map(owners.map((o) => [o.id, o]));
    const unit = new Map(units.map((u) => [u.id, u]));
    const lease = new Map(leases.map((l) => [l.id, l]));
    const unitLabel = (id: string) => { const u = unit.get(id); return u ? `${u.property} · ${u.name}` : ""; };
    const active = new Map(leases.filter((l) => l.status === "active").map((l) => [l.unitId, l]));
    return {
      data: {
        canManage: ws.can("rentals.manage"), today, methods: RENT_METHODS, kinds: UNIT_KINDS,
        listings: listings.map((l) => ({ id: l.id, code: l.code, title: l.title })),
        pending: pending.map((p) => { const l = lease.get(p.bill.leaseId); return { id: p.id, billId: p.billId, bill: billNo(p.bill.seq), month: p.bill.month, renter: l?.renter ?? "", unit: l ? unitLabel(l.unitId) : "", amount: p.amount, method: p.method, ref: p.ref ?? "", paidOn: day(p.paidOn), to: p.collectedBy, hasProof: !!p.proofFile }; }),
        owners: owners.map((o) => ({ id: o.id, name: o.name, phone: o.phone ?? "", email: o.email ?? "", feePct: o.feeBp / 100, bank: o.bank ?? "", note: o.note ?? "", branchId: o.branchId, branch: br.get(o.branchId) ?? "", units: units.filter((u) => u.ownerId === o.id).length })),
        units: units.map((u) => {
          const l = active.get(u.id);
          return { id: u.id, listingId: u.listingId, listing: u.listingId ? codes.get(u.listingId) ?? "" : "", ownerId: u.ownerId, owner: owner.get(u.ownerId)?.name ?? "", property: u.property, name: u.name, kind: u.kind, rent: u.rent, status: u.status, branchId: u.branchId, branch: br.get(u.branchId) ?? "",
            lease: l ? { id: l.id, no: leaseNo(l.seq), renter: l.renter, end: day(l.endOn) } : null, used: leases.some((x) => x.unitId === u.id) || repairs.some((r) => r.unitId === u.id) };
        }),
        leases: leases.map((l) => ({
          id: l.id, no: leaseNo(l.seq), unitId: l.unitId, unit: unitLabel(l.unitId), renter: l.renter, phone: l.phone ?? "", email: l.email ?? "", start: day(l.startOn), end: day(l.endOn),
          rent: l.rent, deposit: l.deposit, dueDay: l.dueDay, lateFeePct: l.lateFeeBp / 100, lateAfterDays: l.lateAfterDays, status: l.status, endedOn: day(l.endedOn),
          depositStatus: l.depositStatus, depositReturned: l.depositReturned, depositNote: l.depositNote ?? "", branch: br.get(l.branchId) ?? "",
        })),
        bills: bills.map((b) => {
          const l = lease.get(b.leaseId);
          return { id: b.id, no: billNo(b.seq), leaseId: b.leaseId, leaseNo: l ? leaseNo(l.seq) : "", renter: l?.renter ?? "", unit: l ? unitLabel(l.unitId) : "", month: b.month, due: day(b.dueOn),
            amount: b.amount, lateFee: b.lateFee, lateWaived: b.lateWaived, paid: b.paid, balance: balanceOf(b), status: billStatus(b, today), branch: br.get(b.branchId) ?? "" };
        }),
        repairs: repairs.map((r) => ({ id: r.id, no: repairNo(r.seq), unitId: r.unitId, unit: unitLabel(r.unitId), owner: owner.get(unit.get(r.unitId)?.ownerId ?? "")?.name ?? "", title: r.title, priority: r.priority, vendor: r.vendor ?? "", cost: r.cost, status: r.status, doneOn: day(r.doneOn), created: day(r.createdAt) })),
      },
    };
  });

  // ───── Owners ─────
  app.post("/rentals/owners", async (request) => {
    const { ws, v } = await start(request, true);
    const b = OwnerBody.parse(request.body);
    const o = await db().rentOwner.create({ data: { tenantId: ws.tenantId, branchId: branchFor(v, b.branchId), name: b.name, phone: b.phone || null, email: b.email || null, feeBp: bp(b.feePct), bank: b.bank || null, note: b.note || null } });
    await audit(ws, request.ip, "rental.owner_added", o.name);
    return { message: `${o.name} added.`, data: { id: o.id } };
  });
  app.put<{ Params: { id: string } }>("/rentals/owners/:id", async (request) => {
    const { ws, v } = await start(request, true);
    const b = OwnerBody.omit({ branchId: true }).parse(request.body);
    const o = await one(await db().rentOwner.findFirst({ where: where(ws, v, request.params.id) }), "Owner");
    await db().rentOwner.update({ where: { id: o.id }, data: { name: b.name, phone: b.phone || null, email: b.email || null, feeBp: bp(b.feePct), bank: b.bank || null, note: b.note || null } });
    await audit(ws, request.ip, "rental.owner_changed", b.name);
    return { message: "Owner saved. A new fee counts from the next statement you save." };
  });
  app.delete<{ Params: { id: string } }>("/rentals/owners/:id", async (request) => {
    const { ws, v } = await start(request, true);
    const o = await one(await db().rentOwner.findFirst({ where: where(ws, v, request.params.id) }), "Owner");
    if (await db().rentUnit.count({ where: { ownerId: o.id } })) throw badRequest(`${o.name} owns units you manage. Remove or move them first.`);
    await db().rentOwner.delete({ where: { id: o.id } });
    await audit(ws, request.ip, "rental.owner_removed", o.name);
    return { message: `${o.name} removed.` };
  });

  // ───── Units ─────
  const ownerOf = async (ws: Workspace, v: BranchView, id: string) => one(await db().rentOwner.findFirst({ where: where(ws, v, id) }), "Owner");
  const listingFor = async (ws: Workspace, id?: number | null) => {
    if (!id) return null;
    const l = await db().listing.findFirst({ where: { id, tenantId: ws.tenantId, status: { not: "removed" } }, select: { id: true } });
    if (!l) throw badRequest("Choose one of your own listings.");
    return l.id;
  };
  app.post("/rentals/units", async (request) => {
    const { ws, v } = await start(request, true);
    const b = UnitBody.parse(request.body);
    const o = await ownerOf(ws, v, b.ownerId);
    const u = await db().rentUnit.create({ data: { tenantId: ws.tenantId, branchId: o.branchId, ownerId: o.id, property: b.property, name: b.name, kind: b.kind, rent: b.rent, status: b.status ?? "vacant", listingId: await listingFor(ws, b.listingId) } });
    await audit(ws, request.ip, "rental.unit_added", `${u.property} · ${u.name}`);
    return { message: `${u.name} added.`, data: { id: u.id } };
  });
  app.put<{ Params: { id: string } }>("/rentals/units/:id", async (request) => {
    const { ws, v } = await start(request, true);
    const b = UnitBody.parse(request.body);
    const u = await one(await db().rentUnit.findFirst({ where: where(ws, v, request.params.id) }), "Unit");
    const o = await ownerOf(ws, v, b.ownerId);
    if (o.branchId !== u.branchId) throw badRequest("Choose an owner of the same branch.");
    // A let unit stays let until its lease ends; the status only changes between vacant and under repair.
    const status = u.status === "let" ? "let" : b.status ?? u.status;
    await db().rentUnit.update({ where: { id: u.id }, data: { ownerId: o.id, property: b.property, name: b.name, kind: b.kind, rent: b.rent, status, listingId: await listingFor(ws, b.listingId) } });
    await audit(ws, request.ip, "rental.unit_changed", `${b.property} · ${b.name}`);
    return { message: "Unit saved. The rent of a running lease doesn't change; change it on the lease." };
  });
  app.delete<{ Params: { id: string } }>("/rentals/units/:id", async (request) => {
    const { ws, v } = await start(request, true);
    const u = await one(await db().rentUnit.findFirst({ where: where(ws, v, request.params.id) }), "Unit");
    const [leases, repairs] = await Promise.all([db().rentLease.count({ where: { unitId: u.id } }), db().rentRepair.count({ where: { unitId: u.id } })]);
    if (leases + repairs) throw badRequest(`${u.name} has leases or repairs on record, so it is kept.`);
    await db().rentUnit.delete({ where: { id: u.id } });
    await audit(ws, request.ip, "rental.unit_removed", `${u.property} · ${u.name}`);
    return { message: `${u.name} removed.` };
  });

  // ───── Leases ─────
  app.post("/rentals/leases", async (request) => {
    const { ws, v } = await start(request, true);
    const b = LeaseBody.parse(request.body);
    if (b.end < b.start) throw badRequest("The lease ends before it starts.");
    const u = await one(await db().rentUnit.findFirst({ where: where(ws, v, b.unitId) }), "Unit");
    const l = await db().$transaction(async (tx) => {
      // The unit is taken only if it is still free, so two leases can't start on one unit.
      const took = await tx.rentUnit.updateMany({ where: { id: u.id, status: { not: "let" } }, data: { status: "let" } });
      if (!took.count || (await tx.rentLease.count({ where: { unitId: u.id, status: "active" } }))) throw badRequest(`${u.name} already has a tenant. End that lease first.`);
      return tx.rentLease.create({ data: { tenantId: ws.tenantId, branchId: u.branchId, unitId: u.id, renter: b.renter, phone: b.phone || null, email: b.email || null, startOn: dayOf(b.start), endOn: dayOf(b.end), rent: b.rent, deposit: b.deposit, dueDay: b.dueDay, lateFeeBp: bp(b.lateFeePct), lateAfterDays: b.lateAfterDays, createdBy: ws.user.id } });
    });
    await runRentBills(db(), { today: nepalDay(), tenantId: ws.tenantId });
    await audit(ws, request.ip, "rental.lease_added", `${leaseNo(l.seq)} ${u.name} Rs. ${l.rent}`);
    return { message: `Lease ${leaseNo(l.seq)} made. Rent bills are made every month on their own.`, data: { id: l.id, no: leaseNo(l.seq) } };
  });

  const activeLease = async (ws: Workspace, v: BranchView, id: string) => {
    const l = await one(await db().rentLease.findFirst({ where: where(ws, v, id) }), "Lease");
    if (l.status !== "active") throw badRequest("This lease has ended.");
    return l;
  };
  app.put<{ Params: { id: string } }>("/rentals/leases/:id", async (request) => {
    const { ws, v } = await start(request, true);
    const b = LeaseChange.parse(request.body);
    const l = await activeLease(ws, v, request.params.id);
    if (b.end < ymd(l.startOn)) throw badRequest("The lease ends before it starts.");
    await db().rentLease.update({ where: { id: l.id }, data: { renter: b.renter, phone: b.phone || null, email: b.email || null, endOn: dayOf(b.end), rent: b.rent, dueDay: b.dueDay, lateFeeBp: bp(b.lateFeePct), lateAfterDays: b.lateAfterDays } });
    await audit(ws, request.ip, "rental.lease_changed", `${leaseNo(l.seq)} Rs. ${l.rent} → ${b.rent}, ends ${b.end}`);
    return { message: "Lease saved. A new rent counts from the next bill; bills already made keep their amount." };
  });
  app.post<{ Params: { id: string } }>("/rentals/leases/:id/end", async (request) => {
    const { ws, v } = await start(request, true);
    const b = z.object({ endedOn: Day, depositReturned: Rupees.nullish(), depositNote: Text(300) }).parse(request.body);
    const l = await activeLease(ws, v, request.params.id);
    if (b.depositReturned != null && b.depositReturned > l.deposit) throw badRequest(`The deposit was Rs. ${l.deposit}; you can't return more.`);
    await db().$transaction(async (tx) => {
      const done = await tx.rentLease.updateMany({ where: { id: l.id, status: "active" }, data: { status: "ended", endedOn: dayOf(b.endedOn), ...(b.depositReturned != null ? { depositStatus: "returned", depositReturned: b.depositReturned, depositNote: b.depositNote || null } : {}) } });
      if (!done.count) throw badRequest("This lease has ended.");
      await tx.rentUnit.update({ where: { id: l.unitId }, data: { status: "vacant" } });
    });
    await audit(ws, request.ip, "rental.lease_ended", `${leaseNo(l.seq)}${b.depositReturned != null ? `, deposit Rs. ${b.depositReturned} returned` : ""}`);
    return { message: `${leaseNo(l.seq)} ended. The unit is vacant.` };
  });
  app.post<{ Params: { id: string } }>("/rentals/leases/:id/deposit", async (request) => {
    const { ws, v } = await start(request, true);
    const b = z.object({ returned: Rupees, note: Text(300) }).parse(request.body);
    const l = await one(await db().rentLease.findFirst({ where: where(ws, v, request.params.id) }), "Lease");
    if (l.depositStatus === "returned") throw badRequest("The deposit is already returned.");
    if (b.returned > l.deposit) throw badRequest(`The deposit was Rs. ${l.deposit}; you can't return more.`);
    await db().rentLease.update({ where: { id: l.id }, data: { depositStatus: "returned", depositReturned: b.returned, depositNote: b.note || null } });
    await audit(ws, request.ip, "rental.deposit_returned", `${leaseNo(l.seq)} Rs. ${b.returned} of ${l.deposit}`);
    return { message: "Deposit marked as returned." };
  });
  // A bill for a month the job missed (a lease entered late, or the server was off).
  app.post<{ Params: { id: string } }>("/rentals/leases/:id/bills", async (request) => {
    const { ws, v } = await start(request, true);
    const b = z.object({ month: Month }).parse(request.body);
    const l = await one(await db().rentLease.findFirst({ where: where(ws, v, request.params.id) }), "Lease");
    if (!leaseCovers(l, b.month)) throw badRequest("The lease doesn't run in that month.");
    if (b.month > nepalDay().slice(0, 7)) throw badRequest("Bills for coming months are made when the month starts.");
    const made = await db().rentBill.createMany({ data: [{ tenantId: l.tenantId, branchId: l.branchId, leaseId: l.id, month: b.month, dueOn: dayOf(`${b.month}-${String(l.dueDay).padStart(2, "0")}`), amount: l.rent }], skipDuplicates: true });
    if (!made.count) throw badRequest("That month already has a bill.");
    await audit(ws, request.ip, "rental.bill_added", `${leaseNo(l.seq)} ${b.month}`);
    return { message: `Bill for ${b.month} made.` };
  });

  // ───── Bills and payments ─────
  const billOf = async (ws: Workspace, v: BranchView, id: string) => one(await db().rentBill.findFirst({ where: where(ws, v, id) }), "Bill");
  app.get<{ Params: { id: string } }>("/rentals/bills/:id", async (request) => {
    const { ws, v } = await start(request);
    const b = await billOf(ws, v, request.params.id);
    const payments = await db().rentPayment.findMany({ where: { billId: b.id }, orderBy: { paidOn: "asc" } });
    return { data: { payments: payments.map((p) => ({ id: p.id, amount: p.amount, method: p.method, paidOn: day(p.paidOn), ref: p.ref ?? "", note: p.note ?? "", status: p.status, online: p.source === "online", to: p.collectedBy })) } };
  });
  app.put<{ Params: { id: string } }>("/rentals/bills/:id", async (request) => {
    const { ws, v } = await start(request, true);
    const body = z.object({ amount: Rupees.refine((n) => n > 0, "The amount must be more than zero.") }).parse(request.body);
    const b = await billOf(ws, v, request.params.id);
    const done = await db().rentBill.updateMany({ where: { id: b.id, paid: 0 }, data: { amount: body.amount } });
    if (!done.count) throw badRequest("Something is already paid on this bill, so its amount stays.");
    await audit(ws, request.ip, "rental.bill_changed", `${billNo(b.seq)} Rs. ${b.amount} → ${body.amount}`);
    return { message: "Bill saved." };
  });
  app.post<{ Params: { id: string } }>("/rentals/bills/:id/waive", async (request) => {
    const { ws, v } = await start(request, true);
    const b = await billOf(ws, v, request.params.id);
    if (!b.lateFee) throw badRequest("This bill has no late fee.");
    if (b.paid > b.amount) throw badRequest("Part of the late fee is already paid, so it can't be waived.");
    const done = await db().rentBill.updateMany({ where: { id: b.id, lateFee: b.lateFee, paid: b.paid }, data: { lateFee: 0, lateWaived: true } });
    if (!done.count) throw badRequest("The bill changed. Open it again.");
    await audit(ws, request.ip, "rental.late_fee_waived", `${billNo(b.seq)} Rs. ${b.lateFee}`);
    return { message: "Late fee waived." };
  });
  app.post<{ Params: { id: string } }>("/rentals/bills/:id/payments", async (request) => {
    const { ws, v } = await start(request, true);
    const p = z.object({ amount: Rupees.refine((n) => n > 0, "The amount must be more than zero."), method: z.enum(RENT_METHODS).default("cash"), paidOn: Day, ref: Text(80), note: Text(300) }).parse(request.body);
    const b = await billOf(ws, v, request.params.id);
    const left = balanceOf(b);
    if (!left) throw badRequest("This bill is fully paid.");
    if (p.amount > left) throw badRequest(`That is more than what is owed (Rs. ${left}).`);
    if (p.paidOn > nepalDay()) throw badRequest("The payment date is in the future.");
    await db().$transaction(async (tx) => {
      // Counted only if nothing was paid on the bill meanwhile, so a double click can't pay it twice.
      const took = await tx.rentBill.updateMany({ where: { id: b.id, paid: b.paid }, data: { paid: { increment: p.amount } } });
      if (!took.count) throw badRequest("The bill changed. Open it again.");
      await tx.rentPayment.create({ data: { tenantId: ws.tenantId, branchId: b.branchId, billId: b.id, amount: p.amount, method: p.method, paidOn: dayOf(p.paidOn), ref: p.ref || null, note: p.note || null, createdBy: ws.user.id } });
    });
    await audit(ws, request.ip, "rental.payment_added", `${billNo(b.seq)} Rs. ${p.amount} ${p.method}`);
    return { message: p.amount === left ? `${billNo(b.seq)} is fully paid.` : `Rs. ${p.amount} recorded. Rs. ${left - p.amount} is still owed.` };
  });
  app.delete<{ Params: { id: string } }>("/rentals/payments/:id", async (request) => {
    const { ws, v } = await start(request, true);
    const p = await one(await db().rentPayment.findFirst({ where: where(ws, v, request.params.id) }), "Payment");
    if (p.status !== "confirmed") throw badRequest("Only a confirmed payment can be removed. Reject a waiting one instead.");
    if (p.collectedBy === "sheetal") throw badRequest("Sheetal Property received this payment. Ask Sheetal to undo it.");
    await db().$transaction(async (tx) => {
      const took = await tx.rentBill.updateMany({ where: { id: p.billId, paid: { gte: p.amount } }, data: { paid: { decrement: p.amount } } });
      if (!took.count) throw badRequest("The bill changed. Open it again.");
      await tx.rentPayment.delete({ where: { id: p.id } });
    });
    await audit(ws, request.ip, "rental.payment_removed", `Rs. ${p.amount} on ${day(p.paidOn)}`);
    return { message: "Payment removed. Saved owner statements for that month don't change; save them again." };
  });

  // ───── Online payments: the business confirms what was paid to its own account; Sheetal confirms the rest ─────
  const onlineOf = async (ws: Workspace, v: BranchView, id: string) => {
    const p = await one(await db().rentPayment.findFirst({ where: where(ws, v, id) }), "Payment");
    if (p.collectedBy === "sheetal") throw forbidden("This was paid to Sheetal Property, so Sheetal checks and confirms it.");
    return p;
  };
  app.post<{ Params: { id: string } }>("/rentals/payments/:id/confirm", async (request) => {
    const { ws, v } = await start(request, true);
    const p = await onlineOf(ws, v, request.params.id);
    const r = await confirmRentPayment(db(), { paymentId: p.id, by: ws.user.id });
    await audit(ws, request.ip, "rental.payment_confirmed", `${r.bill} Rs. ${r.amount} online`);
    return { message: `Confirmed. Rs. ${r.amount} is added to ${r.bill}.` };
  });
  app.post<{ Params: { id: string } }>("/rentals/payments/:id/reject", async (request) => {
    const { ws, v } = await start(request, true);
    const b = z.object({ note: z.string().trim().min(3, "Say why, so the tenant knows.").max(300) }).parse(request.body);
    const p = await onlineOf(ws, v, request.params.id);
    await rejectRentPayment(db(), { paymentId: p.id, by: ws.user.id, note: b.note });
    await audit(ws, request.ip, "rental.payment_rejected", b.note);
    return { message: "Rejected. The tenant sees why in My rentals." };
  });
  app.get<{ Params: { id: string } }>("/rentals/payments/:id/proof", async (request) => {
    const { ws, v } = await start(request);
    const p = await one(await db().rentPayment.findFirst({ where: where(ws, v, request.params.id) }), "Payment");
    const f = p.proofFile ? await readPrivateFile(app.config.MEDIA_DIR, "proofs", p.proofFile) : null;
    if (!f) throw notFound("No screenshot was sent with this payment.");
    return { data: { type: f.type, data: f.data.toString("base64") } };
  });

  // ───── Repairs ─────
  app.post("/rentals/repairs", async (request) => {
    const { ws, v } = await start(request, true);
    const b = RepairBody.extend({ unitId: z.string().min(1).max(40) }).parse(request.body);
    const u = await one(await db().rentUnit.findFirst({ where: where(ws, v, b.unitId) }), "Unit");
    const r = await db().rentRepair.create({ data: { tenantId: ws.tenantId, branchId: u.branchId, unitId: u.id, title: b.title, priority: b.priority, vendor: b.vendor || null, cost: b.cost, status: b.status, doneOn: b.status === "done" ? dayOf(b.doneOn ?? nepalDay()) : null, createdBy: ws.user.id } });
    await audit(ws, request.ip, "rental.repair_added", `${repairNo(r.seq)} ${r.title}`);
    return { message: "Repair logged.", data: { id: r.id } };
  });
  app.put<{ Params: { id: string } }>("/rentals/repairs/:id", async (request) => {
    const { ws, v } = await start(request, true);
    const b = RepairBody.parse(request.body);
    const r = await one(await db().rentRepair.findFirst({ where: where(ws, v, request.params.id) }), "Repair");
    const doneOn = b.status === "done" ? dayOf(b.doneOn ?? (r.doneOn ? ymd(r.doneOn) : nepalDay())) : null;
    await db().rentRepair.update({ where: { id: r.id }, data: { title: b.title, priority: b.priority, vendor: b.vendor || null, cost: b.cost, status: b.status, doneOn } });
    await audit(ws, request.ip, "rental.repair_changed", `${repairNo(r.seq)} ${b.status} Rs. ${b.cost}`);
    return { message: b.status === "done" ? "Marked done. The cost comes off the owner's statement for that month." : "Repair saved." };
  });

  // ───── Owner statements ─────
  app.get("/rentals/statements", async (request) => {
    const { ws, v } = await start(request);
    const q = z.object({ month: Month.optional() }).parse(request.query);
    const month = q.month ?? nepalDay().slice(0, 7);
    const owners = await db().rentOwner.findMany({ where: { tenantId: ws.tenantId, ...inView(v) }, orderBy: { name: "asc" } });
    const [lines, saved] = await Promise.all([
      statementsFor(db(), { tenantId: ws.tenantId, month, owners }),
      db().ownerStatement.findMany({ where: { tenantId: ws.tenantId, month, ownerId: { in: owners.map((o) => o.id) } } }),
    ]);
    const kept = new Map(saved.map((s) => [s.ownerId, s]));
    return {
      data: {
        month, canManage: ws.can("rentals.manage"),
        rows: owners.map((o) => {
          const s = lines.get(o.id)!; const k = kept.get(o.id);
          return { ...s, owner: o.name, bank: o.bank ?? "", feePct: o.feeBp / 100,
            saved: k ? { id: k.id, collected: k.collected, fee: k.fee, repairs: k.repairs, payable: k.payable, at: k.updatedAt.toISOString(), current: k.collected === s.collected && k.fee === s.fee && k.repairs === s.repairs } : null };
        }),
      },
    };
  });
  app.post("/rentals/statements", async (request) => {
    const { ws, v } = await start(request, true);
    const b = z.object({ ownerId: z.string().min(1).max(40), month: Month }).parse(request.body);
    if (b.month > nepalDay().slice(0, 7)) throw badRequest("That month hasn't started yet.");
    const o = await ownerOf(ws, v, b.ownerId);
    const s = (await statementsFor(db(), { tenantId: ws.tenantId, month: b.month, owners: [o] })).get(o.id)!;
    const data = { collected: s.collected, fee: s.fee, repairs: s.repairs, payable: s.payable, createdBy: ws.user.id };
    await db().ownerStatement.upsert({ where: { ownerId_month: { ownerId: o.id, month: b.month } }, create: { tenantId: ws.tenantId, branchId: o.branchId, ownerId: o.id, month: b.month, ...data }, update: data });
    await audit(ws, request.ip, "rental.statement_saved", `${o.name} ${b.month}: fee Rs. ${s.fee}, owed Rs. ${s.payable}`);
    return { message: `Statement saved. Your fee of Rs. ${s.fee} now counts in your profit.` };
  });
  app.delete<{ Params: { id: string } }>("/rentals/statements/:id", async (request) => {
    const { ws, v } = await start(request, true);
    const s = await one(await db().ownerStatement.findFirst({ where: where(ws, v, request.params.id) }), "Statement");
    await db().ownerStatement.delete({ where: { id: s.id } });
    await audit(ws, request.ip, "rental.statement_removed", `${s.month}`);
    return { message: "Statement removed. Its fee no longer counts in your profit." };
  });
}

/** Makes rent bills and late fees every 6 hours (and shortly after start). Safe to repeat. The Rentals page also runs
 *  it when it opens, so nothing waits for the job. */
export function startRentJob(app: FastifyInstance) {
  const run = () => runRentBills(dbOf(app), { today: nepalDay() })
    .then((r) => { if (r.bills || r.lateFees) app.log.info(r, "rent bills"); })
    .catch((e) => app.log.error({ err: e }, "rent bills failed"));
  const first = setTimeout(run, 50_000);
  const every = setInterval(run, 6 * 3600_000);
  app.addHook("onClose", async () => { clearTimeout(first); clearInterval(every); });
}

