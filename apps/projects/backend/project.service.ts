// The rules of Projects (units, holds, reservations and their payments), on the kernel. Moved from business/backend/src/modules/projects/routes.ts (P2-W3),
// every rule and message unchanged.
// Where it fits: ProjectController calls one method per route.
// How it works: units belong to a project listing; a hold lapses on its own; a reservation has a payment plan and its payments (fully paid = sold, in the same
// transaction as the payment). Every write runs in ONE transaction with its audit line (the old action strings where there was one) and its event.
// Rules: who may do what is the old any-of lists (a reservation's payment needs collections.payment.create, a refund collections.payment.refund); a unit is held
// or reserved by one buyer at a time (compare-and-set); everything follows its listing's branch; a refund can't be more than was paid, a payment not more than
// what is due; the instalments must add up to the price. A read-only support session changes nothing.

import { z } from "zod";
import { badRequest, conflict, forbidden, notFound, versionConflict } from "@sheetal/platform/core/errors";
import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseService } from "@sheetal/platform/core/service";
import { PROJECT_EVENTS } from "./events.js";
import { live, reservationJson, reservationNo, unitJson } from "./presenter.js";
import { ReservationRepository, UnitRepository, listingInView, listingsOfKind } from "./repositories.js";
import * as S from "./schemas.js";
import type { UnitRow } from "./types.js";

const all4 = (r: string) => `${r}.read+${r}.create+${r}.update+${r}.delete`;
export const PROJECT = all4("projects.project");
export const RESERVATION = all4("projects.reservation");
export const VISIT = all4("projects.visit");
export const COLLECT = "collections.payment.read+collections.payment.create";
export const REFUND = "collections.payment.refund";

export class ProjectService extends BaseService<UnitRow, never, Partial<UnitRow>> {
  readonly units = new UnitRepository();
  readonly reservations = new ReservationRepository();
  constructor(deps: { bus: EventBus }) {
    super({
      app: "projects", resource: "unit", repo: new UnitRepository(),
      permissions: { read: PROJECT, create: PROJECT, update: PROJECT, delete: PROJECT },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "unit", label: (u) => `${u.block}${u.no}` },
      bus: deps.bus, requireVersion: false,
    });
  }

  /** The old need(): any one of these is enough. The data scope is the branch view (the app is capped at "branch"). */
  private need(ctx: BusinessContext, ...perms: string[]): DataScope {
    if (!perms.some((p) => ctx.permissions.can(p))) throw forbidden("Your role can't do this.");
    return "branch";
  }
  /** One write: transaction, then the audit line (when there is one) and the event, all together. */
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => { audit?: { action: string; target: string }; event: { name: string; payload: object } }): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      if (a.audit) await this.writeAudit(tx, a.audit.action, a.audit.target);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1);
      return r;
    });
  }

  // ───── Projects and units ─────

  async projects(ctx: BusinessContext) {
    const scope = this.need(ctx, PROJECT, RESERVATION, VISIT, COLLECT, "workspace.overview.read");
    const [projects, units] = await Promise.all([
      listingsOfKind(ctx, scope, "project", { id: true, code: true, title: true, status: true, district: true, area: true }),
      this.units.all(ctx, scope),
    ]);
    return projects.map((p) => {
      const us = units.filter((u) => u.listingId === p.id);
      const count = (s: string) => us.filter((u) => live(u) === s).length;
      return { ...p, units: us.map(unitJson), summary: { total: us.length, available: count("available"), held: count("held"), reserved: count("reserved"), sold: count("sold") } };
    });
  }

  async addUnits(ctx: BusinessContext, listingId: number, raw: unknown) {
    const scope = this.need(ctx, PROJECT);
    const p = await listingInView(ctx, scope, listingId, "project");
    const b = S.AddUnits.parse(raw);
    const plan = await this.units.planLimits(ctx);
    const total = await this.units.countAll(ctx);
    if (plan.units !== undefined && plan.units !== -1 && total + b.nos.length > plan.units) throw badRequest(`Your plan has room for ${plan.units} units. Upgrade to add more.`);
    const count = await this.write(ctx, (tx) => this.units.addMany(tx, p.id, b), (c) => ({ audit: { action: "units.added", target: `${c} in ${p.code}` }, event: { name: PROJECT_EVENTS.unitsAdded, payload: { listingId: p.id, count: c } } }));
    return { message: count === b.nos.length ? `${count} units added.` : `${count} added; ${b.nos.length - count} already existed.` };
  }

  async editUnit(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.need(ctx, PROJECT);
    const { version, ...b } = S.EditUnit.parse(raw);
    const u = await this.units.one(ctx, scope, id);
    if (b.blocked !== undefined && !["available", "blocked"].includes(live(u))) throw badRequest("Only free units can be blocked or unblocked.");
    if (version !== undefined && version !== u.version) throw versionConflict("This unit");
    await this.write(ctx, (tx) => this.units.update(tx, u.id, { price: b.price === undefined ? undefined : BigInt(b.price), type: b.type, sizeSqft: b.sizeSqft, status: b.blocked === undefined ? undefined : b.blocked ? "blocked" : "available" } as Partial<UnitRow>, scope, version),
      (r) => ({ event: { name: PROJECT_EVENTS.unitChanged, payload: { id: r.id, status: r.status } } }));
    return { message: "Saved." };
  }

  async hold(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.need(ctx, RESERVATION, VISIT);
    const { days } = S.Hold.parse(raw ?? {});
    const until = new Date(Date.now() + days * 864e5);
    await this.write(ctx, async (tx) => { if (!(await this.units.hold(tx, scope, id, until))) throw conflict("This unit isn't free."); return id; },
      () => ({ event: { name: PROJECT_EVENTS.unitHeld, payload: { id, days } } }));
    return { message: `Held for ${days} day${days > 1 ? "s" : ""}.` };
  }

  // ───── Reservations and their payments ─────

  async reservationList(ctx: BusinessContext) {
    const scope = this.need(ctx, RESERVATION, COLLECT, PROJECT);
    return (await this.reservations.allFull(ctx, scope)).map(reservationJson);
  }

  async reserve(ctx: BusinessContext, unitId: string, raw: unknown) {
    const scope = this.need(ctx, RESERVATION);
    const b = S.Reserve.parse(raw);
    const u = await this.units.one(ctx, scope, unitId);
    if (!["available", "held"].includes(live(u))) throw conflict("This unit is already reserved or sold.");
    const price = BigInt(b.price ?? Number(u.price));
    if (b.plan.length && b.plan.reduce((s, p) => s + p.amount, 0) !== Number(price)) throw badRequest("The instalments must add up to the price.");
    const created = await this.write(ctx, async (tx) => {
      if (!(await this.units.move(tx, u.id, u.status, { status: "reserved", holdUntil: null }))) throw conflict("Someone else just reserved this unit.");
      return this.reservations.open(tx, { unitId: u.id, buyerName: b.buyer, phone: b.phone, email: b.email || null, price, plan: b.plan, notes: b.notes });
    }, (r) => ({ audit: { action: "reservation.created", target: `${u.block}${u.no} ${b.buyer}` }, event: { name: PROJECT_EVENTS.reserved, payload: { id: r.id, unitId: u.id, price: Number(price) } } }));
    return { message: `Unit ${u.block}${u.no} reserved for ${b.buyer}.`, data: reservationJson((await this.reservations.full(ctx, "all", created.id))!) };
  }

  async pay(ctx: BusinessContext, id: string, raw: unknown) {
    const b = S.Pay.parse(raw);
    const scope = this.need(ctx, b.amount < 0 ? REFUND : COLLECT);
    const r = await this.reservations.full(ctx, scope, id);
    if (!r || r.status === "cancelled") throw notFound("Reservation not found.");
    const done = await this.write(ctx, async (tx) => {
      // Read again inside the transaction, so two payments at the same moment can't both pass the "not more than due" check on old numbers.
      const cur = (await this.reservations.full(tx, scope, id))!;
      const paid = cur.collections.reduce((s, c) => s + Number(c.amount), 0) + b.amount;
      if (paid < 0) throw badRequest("A refund can't be more than what was paid.");
      if (paid > Number(cur.price)) throw badRequest(`That's more than the Rs. ${(Number(cur.price) - paid + b.amount).toLocaleString("en-IN")} still due.`);
      await this.reservations.addPayment(tx, cur.id, b);
      // Fully paid: the unit is sold (in the same transaction as the payment).
      const sold = paid === Number(cur.price) && cur.status !== "sold";
      if (sold) {
        await this.reservations.move(tx, cur.id, cur.status, { status: "sold" });
        await this.units.move(tx, cur.unitId, null, { status: "sold" });
      }
      return { paid, sold, full: paid === Number(cur.price) };
    }, (x) => ({ audit: { action: b.amount < 0 ? "collection.refund" : "collection.received", target: `${reservationNo(r.seq)} Rs. ${b.amount}` }, event: { name: x.sold ? PROJECT_EVENTS.sold : PROJECT_EVENTS.paid, payload: { id: r.id, amount: b.amount, paid: x.paid } } }));
    return { message: done.full ? "Fully paid. The unit is sold." : b.amount < 0 ? "Refund recorded." : `Rs. ${b.amount.toLocaleString("en-IN")} received.`, data: reservationJson((await this.reservations.full(ctx, "all", r.id))!) };
  }

  async cancel(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.need(ctx, RESERVATION);
    const { note } = S.CancelBody.parse(raw);
    const r = await this.reservations.full(ctx, scope, id);
    if (!r || r.status !== "reserved") throw badRequest("Only open reservations can be cancelled.");
    await this.write(ctx, async (tx) => {
      if (!(await this.reservations.move(tx, r.id, "reserved", { status: "cancelled", notes: [r.notes, `Cancelled: ${note}`].filter(Boolean).join("\n") }))) throw badRequest("Only open reservations can be cancelled.");
      await this.units.move(tx, r.unitId, null, { status: "available" });
      return r;
    }, () => ({ audit: { action: "reservation.cancelled", target: `${reservationNo(r.seq)}: ${note}` }, event: { name: PROJECT_EVENTS.cancelled, payload: { id: r.id, unitId: r.unitId } } }));
    return { message: "Reservation cancelled; the unit is free again. Record any refund as a negative collection." };
  }
}
