import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma, Unit } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { branchView, inView, workspaceOf, type Workspace } from "../access.js";

// Developers: the units of each project (from its project listing), short holds, reservations with a payment plan,
// and collections against them. A unit can be held or reserved by one buyer at a time; a hold lapses on its own.
// Sponsors: commitments to an investment listing, marked paid, and updates emailed to the investors.

const n = (v: bigint | number | null | undefined) => (v == null ? null : Number(v));
const money = z.number().int().min(0).max(1e12);

export async function projectRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const need = (ws: Workspace, ...perms: string[]) => { if (!perms.some(ws.can)) throw forbidden("Your role can't do this."); };
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action, target, ip } });
  /** A hold that has passed its time counts as available. */
  const live = (u: Unit) => (u.status === "held" && u.holdUntil && u.holdUntil < new Date() ? "available" : u.status);
  const unitJson = (u: Unit) => ({ id: u.id, listingId: u.listingId, block: u.block, no: u.no, type: u.type, sizeSqft: u.sizeSqft, price: n(u.price), status: live(u), holdUntil: live(u) === "held" ? u.holdUntil : null });
  // Units, reservations, investor commitments and updates belong to their project or investment listing, so they
  // follow that listing's branch: people see those of the branches in view.
  /** Ids of the business's listings in the branches in view; null = the whole business. */
  async function inBranches(ws: Workspace, request: FastifyRequest) {
    const v = await branchView(db(), request, ws);
    return v.ids ? (await db().listing.findMany({ where: { tenantId: ws.tenantId, ...inView(v) }, select: { id: true } })).map((l) => l.id) : null;
  }
  const of = (ids: number[] | null) => (ids ? { listingId: { in: ids } } : {});
  async function myListing(ws: Workspace, request: FastifyRequest, id: number, kind: "project" | "invest") {
    const l = await db().listing.findFirst({ where: { id, tenantId: ws.tenantId, kind, status: { not: "removed" }, ...inView(await branchView(db(), request, ws)) } });
    if (!l) throw notFound(kind === "project" ? "Project not found." : "Investment not found.");
    return l;
  }

  // ───── Projects and units ─────
  app.get("/projects", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "projects.manage", "reservations.manage", "visits.manage", "collect.payments", "overview.view");
    const ids = await inBranches(ws, request);
    const projects = await db().listing.findMany({ where: { tenantId: ws.tenantId, kind: "project", status: { not: "removed" }, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, code: true, title: true, status: true, district: true, area: true } });
    const units = await db().unit.findMany({ where: { tenantId: ws.tenantId, ...of(ids) }, orderBy: [{ block: "asc" }, { no: "asc" }] });
    return { data: projects.map((p) => {
      const us = units.filter((u) => u.listingId === p.id);
      const count = (s: string) => us.filter((u) => live(u) === s).length;
      return { ...p, units: us.map(unitJson), summary: { total: us.length, available: count("available"), held: count("held"), reserved: count("reserved"), sold: count("sold") } };
    }) };
  });

  app.post<{ Params: { id: string } }>("/projects/:id/units", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "projects.manage");
    const p = await myListing(ws, request, Number(request.params.id) || -1, "project");
    const b = z.object({ block: z.string().trim().max(20).default(""), type: z.string().trim().min(1).max(40), sizeSqft: z.number().int().min(0).optional(), price: money, nos: z.array(z.string().trim().min(1).max(20)).min(1).max(500) }).parse(request.body);
    const plan = ws.member.tenant.plan.limits as Record<string, number>;
    const total = await db().unit.count({ where: { tenantId: ws.tenantId } });
    if (plan.units !== undefined && plan.units !== -1 && total + b.nos.length > plan.units) throw badRequest(`Your plan has room for ${plan.units} units. Upgrade to add more.`);
    const r = await db().unit.createMany({ data: b.nos.map((no) => ({ tenantId: ws.tenantId, listingId: p.id, block: b.block, no, type: b.type, sizeSqft: b.sizeSqft, price: BigInt(b.price) })), skipDuplicates: true });
    await audit(ws, request.ip, "units.added", `${r.count} in ${p.code}`);
    return { message: r.count === b.nos.length ? `${r.count} units added.` : `${r.count} added; ${b.nos.length - r.count} already existed.` };
  });

  app.patch<{ Params: { id: string } }>("/units/:id", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "projects.manage");
    const b = z.object({ price: money.optional(), type: z.string().max(40).optional(), sizeSqft: z.number().int().min(0).optional(), blocked: z.boolean().optional() }).parse(request.body);
    const u = await db().unit.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, ...of(await inBranches(ws, request)) } });
    if (!u) throw notFound("Unit not found.");
    if (b.blocked !== undefined && !["available", "blocked"].includes(live(u))) throw badRequest("Only free units can be blocked or unblocked.");
    await db().unit.update({ where: { id: u.id }, data: { price: b.price === undefined ? undefined : BigInt(b.price), type: b.type, sizeSqft: b.sizeSqft, status: b.blocked === undefined ? undefined : b.blocked ? "blocked" : "available" } });
    return { message: "Saved." };
  });

  app.post<{ Params: { id: string } }>("/units/:id/hold", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "reservations.manage", "visits.manage");
    const { days } = z.object({ days: z.number().int().min(1).max(14).default(3) }).parse(request.body ?? {});
    const until = new Date(Date.now() + days * 864e5);
    // Only one person can hold it: the update only matches a free unit (or one whose hold has run out).
    const r = await db().unit.updateMany({ where: { id: request.params.id, tenantId: ws.tenantId, ...of(await inBranches(ws, request)), OR: [{ status: "available" }, { status: "held", holdUntil: { lt: new Date() } }] }, data: { status: "held", holdUntil: until } });
    if (!r.count) throw conflict("This unit isn't free.");
    return { message: `Held for ${days} day${days > 1 ? "s" : ""}.` };
  });

  // ───── Reservations and collections ─────
  const resJson = async (where: Prisma.ReservationWhereInput) => {
    const rows = await db().reservation.findMany({ where, include: { unit: true, collections: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } });
    return rows.map((r) => {
      const paid = r.collections.reduce((s, c) => s + Number(c.amount), 0);
      const plan = (r.plan as { label: string; due: string; amount: number }[]) ?? [];
      let left = paid;
      const steps = plan.map((p) => { const covered = Math.min(left, p.amount); left -= covered; return { ...p, paid: covered, done: covered >= p.amount, overdue: covered < p.amount && p.due < new Date().toISOString().slice(0, 10) }; });
      return {
        id: r.id, code: `RS-${String(r.seq).padStart(4, "0")}`, status: r.status, buyer: r.buyerName, phone: r.phone, email: r.email, price: n(r.price), paid, due: Number(r.price) - paid,
        unit: unitJson(r.unit), plan: steps, collections: r.collections.map((c) => ({ id: c.id, amount: n(c.amount), method: c.method, ref: c.ref, note: c.note, at: c.createdAt })), createdAt: r.createdAt,
      };
    });
  };
  app.get("/reservations", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "reservations.manage", "collect.payments", "projects.manage");
    const ids = await inBranches(ws, request);
    return { data: await resJson({ tenantId: ws.tenantId, ...(ids ? { unit: { listingId: { in: ids } } } : {}) }) };
  });

  app.post<{ Params: { id: string } }>("/units/:id/reserve", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "reservations.manage");
    const b = z.object({
      buyer: z.string().trim().min(2).max(80), phone: z.string().trim().max(30).optional(), email: z.union([z.email(), z.literal("")]).optional(), price: money.optional(),
      plan: z.array(z.object({ label: z.string().trim().min(1).max(60), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: money })).max(60).default([]), notes: z.string().max(1000).optional(),
    }).parse(request.body);
    const u = await db().unit.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, ...of(await inBranches(ws, request)) } });
    if (!u) throw notFound("Unit not found.");
    if (!["available", "held"].includes(live(u))) throw conflict("This unit is already reserved or sold.");
    const price = BigInt(b.price ?? Number(u.price));
    if (b.plan.length && b.plan.reduce((s, p) => s + p.amount, 0) !== Number(price)) throw badRequest("The instalments must add up to the price.");
    const created = await db().$transaction(async (tx) => {
      const r = await tx.unit.updateMany({ where: { id: u.id, status: u.status }, data: { status: "reserved", holdUntil: null } });
      if (!r.count) throw conflict("Someone else just reserved this unit.");
      return tx.reservation.create({ data: { tenantId: ws.tenantId, unitId: u.id, buyerName: b.buyer, phone: b.phone, email: b.email || null, price, plan: b.plan, notes: b.notes, createdBy: ws.user.id } });
    });
    await audit(ws, request.ip, "reservation.created", `${u.block}${u.no} ${b.buyer}`);
    return { message: `Unit ${u.block}${u.no} reserved for ${b.buyer}.`, data: (await resJson({ id: created.id }))[0] };
  });

  app.post<{ Params: { id: string } }>("/reservations/:id/collections", async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({ amount: z.number().int().refine((v) => v !== 0).refine((v) => Math.abs(v) <= 1e12), method: z.enum(["cash", "bank", "cheque", "fonepay", "esewa", "khalti"]), ref: z.string().trim().max(80).optional(), note: z.string().trim().max(200).optional() }).parse(request.body);
    need(ws, b.amount < 0 ? "collect.refund" : "collect.payments");
    const ids = await inBranches(ws, request);
    const r = await db().reservation.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, ...(ids ? { unit: { listingId: { in: ids } } } : {}) }, include: { collections: true } });
    if (!r || r.status === "cancelled") throw notFound("Reservation not found.");
    const paid = r.collections.reduce((s, c) => s + Number(c.amount), 0) + b.amount;
    if (paid < 0) throw badRequest("A refund can't be more than what was paid.");
    if (paid > Number(r.price)) throw badRequest(`That's more than the Rs. ${(Number(r.price) - paid + b.amount).toLocaleString("en-IN")} still due.`);
    await db().$transaction(async (tx) => {
      await tx.collection.create({ data: { reservationId: r.id, tenantId: ws.tenantId, amount: BigInt(b.amount), method: b.method, ref: b.ref, note: b.note, byUserId: ws.user.id } });
      // Fully paid: the unit is sold.
      if (paid === Number(r.price) && r.status !== "sold") {
        await tx.reservation.update({ where: { id: r.id }, data: { status: "sold" } });
        await tx.unit.update({ where: { id: r.unitId }, data: { status: "sold" } });
      }
    });
    await audit(ws, request.ip, b.amount < 0 ? "collection.refund" : "collection.received", `RS-${String(r.seq).padStart(4, "0")} Rs. ${b.amount}`);
    return { message: paid === Number(r.price) ? "Fully paid. The unit is sold." : b.amount < 0 ? "Refund recorded." : `Rs. ${b.amount.toLocaleString("en-IN")} received.`, data: (await resJson({ id: r.id }))[0] };
  });

  app.post<{ Params: { id: string } }>("/reservations/:id/cancel", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "reservations.manage");
    const { note } = z.object({ note: z.string().trim().min(3, "Say why.").max(300) }).parse(request.body);
    const ids = await inBranches(ws, request);
    const r = await db().reservation.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, ...(ids ? { unit: { listingId: { in: ids } } } : {}) } });
    if (!r || r.status !== "reserved") throw badRequest("Only open reservations can be cancelled.");
    await db().$transaction([
      db().reservation.update({ where: { id: r.id }, data: { status: "cancelled", notes: [r.notes, `Cancelled: ${note}`].filter(Boolean).join("\n") } }),
      db().unit.update({ where: { id: r.unitId }, data: { status: "available" } }),
    ]);
    await audit(ws, request.ip, "reservation.cancelled", `RS-${String(r.seq).padStart(4, "0")}: ${note}`);
    return { message: "Reservation cancelled; the unit is free again. Record any refund as a negative collection." };
  });

  // ───── Investments (sponsors) ─────
  app.get("/investments", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "investments.manage", "investors.view");
    const ids = await inBranches(ws, request);
    const ls = await db().listing.findMany({ where: { tenantId: ws.tenantId, kind: "invest", status: { not: "removed" }, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, code: true, title: true, status: true, price: true } });
    const cs = await db().commitment.findMany({ where: { tenantId: ws.tenantId, ...of(ids) }, orderBy: { createdAt: "desc" } });
    const ups = await db().investmentUpdate.findMany({ where: { tenantId: ws.tenantId, ...of(ids) }, orderBy: { createdAt: "desc" }, take: 100 });
    return { data: ls.map((l) => {
      const mine = cs.filter((c) => c.listingId === l.id && c.status !== "refunded");
      return { id: l.id, code: l.code, title: l.title, status: l.status, target: n(l.price),
        pledged: mine.reduce((s, c) => s + Number(c.amount), 0), paid: mine.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.amount), 0),
        investors: cs.filter((c) => c.listingId === l.id).map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, amount: n(c.amount), status: c.status, paidAt: c.paidAt, ref: c.ref })),
        updates: ups.filter((u) => u.listingId === l.id).map((u) => ({ id: u.id, title: u.title, body: u.body, at: u.createdAt })) };
    }) };
  });

  app.post<{ Params: { id: string } }>("/investments/:id/commitments", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "investments.manage");
    const l = await myListing(ws, request, Number(request.params.id) || -1, "invest");
    const b = z.object({ name: z.string().trim().min(2).max(80), email: z.union([z.email(), z.literal("")]).optional(), phone: z.string().trim().max(30).optional(), amount: money.refine((v) => v > 0) }).parse(request.body);
    await db().commitment.create({ data: { tenantId: ws.tenantId, listingId: l.id, name: b.name, email: b.email || null, phone: b.phone, amount: BigInt(b.amount) } });
    return { message: `${b.name}: Rs. ${b.amount.toLocaleString("en-IN")} pledged.` };
  });

  app.patch<{ Params: { id: string } }>("/commitments/:id", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "investments.manage");
    const b = z.object({ status: z.enum(["paid", "refunded"]), ref: z.string().trim().max(80).optional() }).parse(request.body);
    const c = await db().commitment.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, ...of(await inBranches(ws, request)) } });
    if (!c) throw notFound("Commitment not found.");
    if (b.status === "paid" && c.status !== "pledged") throw badRequest("Only pledges can be marked paid.");
    if (b.status === "refunded" && c.status === "refunded") throw badRequest("Already refunded.");
    await db().commitment.update({ where: { id: c.id }, data: { status: b.status, ref: b.ref ?? c.ref, paidAt: b.status === "paid" ? new Date() : c.paidAt } });
    await audit(ws, request.ip, `investment.${b.status}`, `${c.name} Rs. ${c.amount}`);
    return { message: b.status === "paid" ? "Marked as paid." : "Marked as refunded." };
  });

  app.post<{ Params: { id: string } }>("/investments/:id/updates", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request);
    need(ws, "updates.post");
    const l = await myListing(ws, request, Number(request.params.id) || -1, "invest");
    const b = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(10).max(5000) }).parse(request.body);
    await db().investmentUpdate.create({ data: { tenantId: ws.tenantId, listingId: l.id, title: b.title, body: b.body, byUserId: ws.user.id } });
    const to = [...new Set((await db().commitment.findMany({ where: { listingId: l.id, status: { not: "refunded" }, email: { not: null } }, select: { email: true } })).map((c) => c.email!.toLowerCase()))];
    for (const email of to) await app.mailer.send({ to: email, subject: `${l.title}: ${b.title}`, text: `${b.body}\n\n— ${ws.member.tenant.name}\n\nYou get this because you invested in ${l.title} through Sheetal Property.` });
    return { message: `Update posted and emailed to ${to.length} investor${to.length === 1 ? "" : "s"}.` };
  });
}
