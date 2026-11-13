// The rules of People (attendance and leave), on the kernel (KERNEL.md section 7).
// Where it fits: PeopleController calls one method per route; the methods call the repositories. Moved from business/backend/src/modules/people/routes.ts
// (P2-W1 stage 2) with every rule and message unchanged.
// How it works: a person checks in and out for themselves (one open check-in at a time; the first check-in of a Nepal day is "late" when it is after the
// business's start time, default 10:00). Leave: types with days a year (made on first use), a request a manager approves or rejects, balances per year.
// Managers see a board for a day, fix or add a record with a reason, and a monthly summary. Saturday is the weekly off day.
// Every write runs in ONE transaction with its audit line (the old action strings) and its event; notifications are sent after the commit.
// Rules: people.person.read sees everyone in view; all four people.person.* change things; a person's own check-in and leave need no People permission
// (as before). You can't decide your own leave unless you own the business. Approving leave is an approvable action ("people.leave.approve"): its rule is
// OFF by default, so it runs at once as before; a business that switches it on gets a second person's check first. A read-only support session changes nothing.

import { z } from "zod";
import { badRequest, conflict, forbidden, notFound, versionConflict } from "@sheetal/platform/core/errors";
import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import type { ApprovalGate, ApprovalSpec } from "@sheetal/platform/core/approval";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseService } from "@sheetal/platform/core/service";
import { notify, teamWith } from "@sheetal/platform/notify/index";
import { LEAVE_APPROVE, PEOPLE_EVENTS } from "./events.js";
import { AttendanceRepository, LeaveRequestRepository, LeaveTypeRepository, TeamDirectory } from "./repositories.js";
import * as S from "./schemas.js";
import { DEFAULT_START, addDays, at, dayOf, hhmm, isOff, minutesOf, monthEnd, nameOf, nepalDayOf, toMinutes, today, valid, workDays, ymd } from "./time.js";
import type { AttendanceRow, LeaveRequestRow, LeaveTypeRow } from "./types.js";

export const READ = "people.person.read";
export const MANAGE = "people.person.read+people.person.create+people.person.update+people.person.delete";

export interface PeopleServiceDeps {
  bus: EventBus;
  approvals?: ApprovalGate & { register(action: string, run: (ctx: BusinessContext, payload: unknown) => Promise<unknown>): void };
  /** Wraps the maker's context when an approved request runs again (the same cap the routes use). */
  wrap?: (ctx: BusinessContext) => BusinessContext;
}

export class PeopleService extends BaseService<AttendanceRow, Partial<AttendanceRow>, Partial<AttendanceRow>> {
  readonly attendance = new AttendanceRepository();
  readonly types = new LeaveTypeRepository();
  readonly leave = new LeaveRequestRepository();
  readonly team = new TeamDirectory();

  constructor(deps: PeopleServiceDeps) {
    super({
      app: "people", resource: "attendance", repo: new AttendanceRepository(),
      permissions: { read: READ, create: MANAGE, update: MANAGE, delete: MANAGE },
      // No standard route is offered: every write is a named action below.
      schemas: { create: z.never(), update: z.never() },
      audit: { entity: "people", label: (r) => r.id },
      bus: deps.bus, requireVersion: false, approvals: deps.approvals,
    });
    deps.approvals?.register(LEAVE_APPROVE, (ctx, payload) => {
      const p = payload as { id: string; body: unknown };
      return this.decide((deps.wrap ?? ((c) => c))(ctx), p.id, p.body);
    });
  }

  private sees(ctx: BusinessContext) { return ctx.permissions.can(READ); }
  private manages(ctx: BusinessContext) { return ctx.permissions.can(MANAGE); }

  /** A person's own change (check-in, leave): no People permission is needed, but the write still runs with its audit line and event in one transaction. */
  private async own<R extends object>(ctx: BusinessContext, a: {
    audit: (r: R) => { action: string; target?: string; meta?: object };
    event?: (r: R) => { name: string; payload: object };
    run: (tx: BusinessContext) => Promise<R>;
  }): Promise<R> {
    this.refuseReadOnly(ctx);
    this.requireApp(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await a.run(tx);
      const line = a.audit(r);
      await this.writeAudit(tx, line.action, line.target as string, line.meta);   // no target = NULL, as before
      const ev = a.event?.(r);
      if (ev) await this.deps.bus.publish(tx, ev.name, ev.payload, 1, { branchId: (r as { branchId?: string | null }).branchId ?? null });
      return r;
    });
  }
  /** A manager's change: the MANAGE permission (and its data scope), then the same transaction. */
  private manage<R extends object>(ctx: BusinessContext, a: {
    name: string; refusal: string;
    approval?: ApprovalSpec;
    audit: (r: R) => { action: string; target?: string; meta?: object };
    event?: (r: R) => { name: string; payload: object };
    run: (tx: BusinessContext, scope: DataScope) => Promise<R>;
  }): Promise<R> {
    this.refuseReadOnly(ctx);
    if (!this.manages(ctx)) throw forbidden(a.refusal);
    return this.action<R>(ctx, {
      name: a.name, permission: MANAGE, approval: a.approval,
      audit: (r) => { const l = a.audit(r); return { action: l.action, target: l.target as string, meta: l.meta }; },
      event: a.event, run: a.run,
    });
  }

  /** The branch for the person's own check-in or leave: the one asked for or picked, else their first open branch. */
  private homeBranch(ctx: BusinessContext, asked?: string | null): string {
    if (asked || ctx.branches.picked) return ctx.branches.branchForNew(asked);
    const open = ctx.branches.mine.find((b) => b.status === "open");
    if (!open) throw forbidden("You aren't given any open branch. Ask the owner to give you one on the Team page.");
    return open.id;
  }
  async workStart(ctx: BusinessContext): Promise<string> {
    const v = ((await this.team.settings(ctx)) as { people?: { workStart?: string } }).people?.workStart;
    return v && S.Time.safeParse(v).success ? v : DEFAULT_START;
  }
  private async lateIn(ctx: BusinessContext, time: string) { return toMinutes(time) > toMinutes(await this.workStart(ctx)); }

  // ───── Me ─────

  async me(ctx: BusinessContext) {
    const me = ctx.member.userId, day = today();
    const [open, todayRows, types, mine, start, used] = await Promise.all([
      this.attendance.openOf(ctx, me), this.attendance.ofDay(ctx, me, day), this.types.all(ctx), this.leave.mineRecent(ctx, me), this.workStart(ctx),
      this.leave.usage(ctx, me, day.slice(0, 4)),
    ]);
    return {
      today: day, workStart: start, canSee: this.sees(ctx), canManage: this.manages(ctx),
      can: { see: this.sees(ctx), manage: this.manages(ctx) },
      open: open ? { id: open.id, day: ymd(open.day), inAt: hhmm(open.inAt), late: open.late, version: open.version } : null,
      records: todayRows.map((r) => ({ id: r.id, inAt: hhmm(r.inAt), outAt: hhmm(r.outAt), late: r.late, version: r.version })),
      balances: types.filter((t) => t.active).map((t) => ({ typeId: t.id, name: t.name, paid: t.paid, perYear: t.daysPerYear, used: used[t.id]?.used ?? 0, pending: used[t.id]?.pending ?? 0 })),
      leaves: mine.map((r) => ({ id: r.id, typeId: r.typeId, from: ymd(r.fromDay), to: ymd(r.toDay), days: r.days, halfDay: r.halfDay, reason: r.reason, status: r.status, note: r.note, version: r.version })),
    };
  }

  // ───── Check in and out ─────

  async checkIn(ctx: BusinessContext, raw: unknown) {
    const b = S.CheckIn.parse(raw);
    const branchId = this.homeBranch(ctx, b.branchId);
    const row = await this.own<AttendanceRow>(ctx, {
      audit: (r) => ({ action: "people.check_in", target: r.id, meta: { branchId, late: r.late } }),
      event: (r) => ({ name: PEOPLE_EVENTS.checkedIn, payload: { id: r.id, userId: r.userId, day: ymd(r.day), late: r.late } }),
      run: async (tx) => {
        const me = tx.member.userId;
        if (await this.attendance.openOf(tx, me)) throw conflict("You are already checked in. Check out first.");
        const now = new Date(), day = nepalDayOf(now);
        const first = !(await this.attendance.countOfDay(tx, me, day));
        const late = first && minutesOf(now) > toMinutes(await this.workStart(tx));
        return this.attendance.create(tx, { branchId, userId: me, day: dayOf(day), inAt: now, inLat: b.lat ?? null, inLng: b.lng ?? null, late, note: b.note || null, source: "app" });
      },
    });
    return { message: row.late ? "Checked in (late)." : "Checked in.", data: { id: row.id, inAt: hhmm(row.inAt), late: row.late, version: row.version } };
  }

  async checkOut(ctx: BusinessContext, raw: unknown) {
    const b = S.CheckOut.parse(raw ?? {});
    const row = await this.own<AttendanceRow>(ctx, {
      audit: (r) => ({ action: "people.check_out", target: r.id }),
      event: (r) => ({ name: PEOPLE_EVENTS.checkedOut, payload: { id: r.id, userId: r.userId, day: ymd(r.day) } }),
      run: async (tx) => {
        const open = await this.attendance.openOf(tx, tx.member.userId);
        if (!open) throw conflict("You aren't checked in.");
        return this.attendance.update(tx, open.id, { outAt: new Date(), outLat: b.lat ?? null, outLng: b.lng ?? null }, "all");
      },
    });
    return { message: "Checked out.", data: { id: row.id, outAt: hhmm(row.outAt), version: row.version } };
  }

  // ───── Board ─────

  async board(ctx: BusinessContext, rawQuery: unknown) {
    if (!this.sees(ctx)) throw forbidden("Your role can't see everyone's attendance.");
    const scope = ctx.permissions.require(READ);
    const q = S.BoardQuery.parse(rawQuery);
    const day = q.day ?? today();
    if (!valid(day)) throw badRequest("That date isn't valid.");
    const [people, recs, leaves, types] = await Promise.all([
      this.team.inView(ctx, ctx.branches.idsFor(scope)), this.attendance.board(ctx, scope, day), this.leave.approvedIn(ctx, scope, day, day), this.types.all(ctx),
    ]);
    const names = new Map(types.map((t) => [t.id, t.name]));
    const off = isOff(day), future = day > today();
    const rows = people.map((p) => {
      const mine = recs.filter((r) => r.userId === p.userId), lv = leaves.find((l) => l.userId === p.userId);
      const status = mine.length ? (mine.some((r) => r.late) ? "late" : mine.every((r) => r.outAt) ? "out" : "in") : lv ? "leave" : off ? "off" : future ? "none" : "absent";
      return { ...p, status, leave: lv ? names.get(lv.typeId) ?? "Leave" : null, records: mine.map((r) => ({ id: r.id, inAt: hhmm(r.inAt), outAt: hhmm(r.outAt), late: r.late, source: r.source, branch: r.branch.name, note: r.note, version: r.version })) };
    });
    const n = (s: string) => rows.filter((r) => r.status === s).length;
    return { day, off, counts: { present: rows.filter((r) => r.records.length).length, late: n("late"), leave: n("leave"), absent: n("absent"), total: rows.length }, rows };
  }

  // ───── Fix or add a record ─────

  async addRecord(ctx: BusinessContext, raw: unknown) {
    const b = S.AddRecord.parse(raw);
    if (!this.manages(ctx)) throw forbidden("Your role can't change attendance.");
    if (!valid(b.day) || b.day > today()) throw badRequest("Pick today or an earlier day.");
    if (b.outTime && b.outTime <= b.inTime) throw badRequest("Check-out must be after check-in.");
    if (!(await this.team.isActiveMember(ctx, b.userId))) throw notFound("That person isn't in this team.");
    const branchId = ctx.branches.branchForNew(b.branchId);
    const row = await this.manage<AttendanceRow>(ctx, {
      name: "attendance.add", refusal: "Your role can't change attendance.",
      audit: (r) => ({ action: "people.attendance_add", target: r.id, meta: { userId: b.userId, day: b.day, in: b.inTime, out: b.outTime ?? null, reason: b.reason } }),
      event: (r) => ({ name: PEOPLE_EVENTS.corrected, payload: { id: r.id, userId: r.userId, day: b.day, added: true } }),
      run: async (tx) => {
        const first = !(await this.attendance.countOfDay(tx, b.userId, b.day, { before: at(b.day, b.inTime) }));
        const late = first && (await this.lateIn(tx, b.inTime));
        return this.attendance.create(tx, { branchId, userId: b.userId, day: dayOf(b.day), inAt: at(b.day, b.inTime), outAt: b.outTime ? at(b.day, b.outTime) : null, late, note: b.reason, source: "manual", editedBy: tx.member.userId });
      },
    });
    return { id: row.id, version: row.version };
  }

  async fixRecord(ctx: BusinessContext, id: string, raw: unknown) {
    if (!this.manages(ctx)) throw forbidden("Your role can't change attendance.");
    const b = S.FixRecord.parse(raw);
    await this.manage<AttendanceRow & { before: AttendanceRow }>(ctx, {
      name: "attendance.fix", refusal: "Your role can't change attendance.",
      audit: (r) => ({ action: "people.attendance_fix", target: r.id, meta: { userId: r.userId, day: ymd(r.day), before: { in: hhmm(r.before.inAt), out: hhmm(r.before.outAt) }, after: { in: hhmm(r.inAt), out: hhmm(r.outAt) }, reason: b.reason } }),
      event: (r) => ({ name: PEOPLE_EVENTS.corrected, payload: { id: r.id, userId: r.userId, day: ymd(r.day), added: false } }),
      run: async (tx, scope) => {
        const r = await this.attendance.find(tx, id, scope);
        if (!r) throw notFound("That record isn't here.");
        if (b.version !== undefined && b.version !== r.version) throw versionConflict("This record");
        const day = ymd(r.day);
        const inTime = b.inTime ?? hhmm(r.inAt)!;
        const outTime = b.outTime === undefined ? hhmm(r.outAt) : b.outTime;
        if (outTime && outTime <= inTime) throw badRequest("Check-out must be after check-in.");
        const inAt = at(day, inTime), outAt = outTime ? at(day, outTime) : null;
        const late = r.late && b.inTime == null ? r.late
          : (await this.lateIn(tx, inTime)) && !(await this.attendance.countOfDay(tx, r.userId, day, { except: r.id, before: inAt }));
        const row = await this.attendance.update(tx, id, { inAt, outAt, late, source: "manual", editedBy: tx.member.userId, note: b.reason }, scope, b.version);
        return { ...row, before: r };
      },
    });
  }

  // ───── Leave types ─────

  async leaveTypes(ctx: BusinessContext) {
    return (await this.types.all(ctx)).map((t) => ({ id: t.id, name: t.name, daysPerYear: t.daysPerYear, paid: t.paid, active: t.active, version: t.version }));
  }

  async addType(ctx: BusinessContext, raw: unknown) {
    if (!this.manages(ctx)) throw forbidden("Your role can't change leave types.");
    const b = S.TypeBody.parse(raw);
    const row = await this.manage<LeaveTypeRow>(ctx, {
      name: "leave_type.add", refusal: "Your role can't change leave types.",
      audit: (r) => ({ action: "people.leave_type_add", target: r.id, meta: b }),
      run: async (tx) => {
        await this.types.all(tx);
        if (await this.types.byName(tx, b.name)) throw conflict("There is already a leave type with that name.");
        return this.types.create(tx, b);
      },
    });
    return { id: row.id };
  }

  async editType(ctx: BusinessContext, id: string, raw: unknown) {
    if (!this.manages(ctx)) throw forbidden("Your role can't change leave types.");
    const { version, ...b } = S.TypeEdit.parse(raw);
    await this.manage<LeaveTypeRow>(ctx, {
      name: "leave_type.edit", refusal: "Your role can't change leave types.",
      audit: (r) => ({ action: "people.leave_type_edit", target: r.id, meta: b }),
      run: async (tx) => {
        const t = await this.types.find(tx, id, "all");
        if (!t) throw notFound("That leave type isn't here.");
        if (b.name && b.name !== t.name && (await this.types.byName(tx, b.name))) throw conflict("There is already a leave type with that name.");
        return this.types.update(tx, id, b, "all", version);
      },
    });
  }

  // ───── Leave requests ─────

  async leaveList(ctx: BusinessContext, rawQuery: unknown) {
    const q = S.LeaveQuery.parse(rawQuery);
    if (!this.sees(ctx)) return [];
    const scope = ctx.permissions.require(READ);
    const page = await this.leave.list(ctx, scope, { filters: q.status ? [{ field: "status", op: "eq", value: q.status }] : [] });
    const [users, types] = await Promise.all([this.team.users(ctx, page.rows.map((r) => r.userId)), this.types.all(ctx)]);
    return page.rows.map((r) => ({
      id: r.id, userId: r.userId, name: nameOf(users.find((u) => u.id === r.userId) ?? { userName: "Removed person", firstName: null, lastName: null }),
      type: types.find((t) => t.id === r.typeId)?.name ?? "Leave", from: ymd(r.fromDay), to: ymd(r.toDay), days: r.days, halfDay: r.halfDay, reason: r.reason,
      status: r.status, note: r.note, version: r.version,
    }));
  }

  async askLeave(ctx: BusinessContext, raw: unknown) {
    const b = S.LeaveAsk.parse(raw);
    if (!valid(b.from) || !valid(b.to)) throw badRequest("Those dates aren't valid.");
    if (b.to < b.from) throw badRequest("The last day is before the first day.");
    if (b.from < today()) throw badRequest("Leave can only start today or later. Ask a manager to fix past days.");
    if (b.halfDay && b.from !== b.to) throw badRequest("A half day is one day.");
    if (b.to > addDays(b.from, 60)) throw badRequest("Ask for up to 60 days at a time.");
    const type = (await this.types.all(ctx)).find((t) => t.id === b.typeId && t.active);
    if (!type) throw badRequest("Pick a leave type.");
    const count = workDays(b.from, b.to);
    if (!count) throw badRequest("Saturday is the weekly off day; pick other days.");
    const n = b.halfDay ? 0.5 : count;
    const me = ctx.member.userId;
    const row = await this.own<LeaveRequestRow>(ctx, {
      audit: (r) => ({ action: "people.leave_request", target: r.id, meta: { type: type.name, from: b.from, to: b.to, days: n } }),
      event: (r) => ({ name: PEOPLE_EVENTS.leaveRequested, payload: { id: r.id, userId: me, typeId: type.id, from: b.from, to: b.to, days: n } }),
      run: async (tx) => {
        if (await this.leave.overlaps(tx, me, b.from, b.to)) throw conflict("You already have leave on some of these days.");
        if (type.daysPerYear > 0) {
          const u = (await this.leave.usage(tx, me, b.from.slice(0, 4)))[type.id] ?? { used: 0, pending: 0 };
          const left = type.daysPerYear - u.used - u.pending;
          if (n > left) throw badRequest(`You have ${Math.max(0, left)} ${type.name} ${left === 1 ? "day" : "days"} left this year.`);
        }
        const branchId = this.homeBranch(tx, b.branchId);
        return this.leave.create(tx, { branchId, userId: me, typeId: type.id, fromDay: dayOf(b.from), toDay: dayOf(b.to), days: n, halfDay: b.halfDay, reason: b.reason || null, status: "pending" });
      },
    });
    // After the commit: the managers of that branch get a bell (as before; a failed bell never undoes the request).
    const who = (await teamWith(ctx.db, ctx.business.id, [MANAGE], row.branchId)).filter((id: string) => id !== me);
    const [u] = await this.team.users(ctx, [me]);
    await notify(ctx.db, who, { tenantId: ctx.business.id, type: "people", title: `Leave request from ${u ? nameOf(u) : "a team member"}`, message: `${type.name}: ${b.from}${b.to !== b.from ? ` to ${b.to}` : ""} (${n} ${n === 1 ? "day" : "days"})`, link: "/business/people" })
      .catch((err: unknown) => ctx.log.warn({ err }, "leave request notification failed"));
    return { id: row.id, version: row.version };
  }

  async cancelLeave(ctx: BusinessContext, id: string) {
    await this.own<LeaveRequestRow>(ctx, {
      audit: (r) => ({ action: "people.leave_cancel", target: r.id }),
      event: (r) => ({ name: PEOPLE_EVENTS.leaveCancelled, payload: { id: r.id, userId: r.userId } }),
      run: async (tx) => {
        const r = await this.leave.mineOne(tx, tx.member.userId, id);
        if (!r) throw notFound("That request isn't here.");
        if (!["pending", "approved"].includes(r.status) || ymd(r.toDay) < today()) throw conflict("This leave can't be cancelled any more.");
        if (!(await this.leave.transition(tx, id, { status: r.status }, { status: "cancelled" }, "all"))) throw conflict("This leave can't be cancelled any more.");
        return { ...r, status: "cancelled" };
      },
    });
  }

  async decide(ctx: BusinessContext, id: string, raw: unknown) {
    if (!this.manages(ctx)) throw forbidden("Your role can't approve leave.");
    const b = S.Decide.parse(raw);
    const scope = ctx.permissions.require(MANAGE);
    // The checks that need no lock come first, so a request that can never pass is refused before any approval request is stored.
    const r0 = await this.leave.find(ctx, id, scope);
    if (!r0) throw notFound("That request isn't here.");
    if (r0.status !== "pending") throw conflict("This request was already handled.");
    if (r0.userId === ctx.member.userId && !ctx.member.isOwner) throw forbidden("Ask another manager to decide your own leave.");
    const done = await this.manage<LeaveRequestRow & { typeName: string }>(ctx, {
      name: "leave.decide", refusal: "Your role can't approve leave.",
      approval: b.status === "approved" ? { action: LEAVE_APPROVE, resource: "leave", resourceId: id, branchId: r0.branchId, payload: { id, body: { status: b.status, note: b.note } } } : undefined,
      audit: (r) => ({ action: b.status === "approved" ? "people.leave_approve" : "people.leave_reject", target: r.id, meta: { userId: r.userId, note: b.note } }),
      event: (r) => ({ name: PEOPLE_EVENTS.leaveDecided, payload: { id: r.id, userId: r.userId, status: b.status } }),
      run: async (tx, sc) => {
        const r = await this.leave.find(tx, id, sc);
        if (!r) throw notFound("That request isn't here.");
        if (r.status !== "pending") throw conflict("This request was already handled.");
        if (b.version !== undefined && b.version !== r.version) throw versionConflict("This request");
        const type = await this.types.find(tx, r.typeId, "all");
        if (b.status === "approved" && type && type.daysPerYear > 0) {
          const u = (await this.leave.usage(tx, r.userId, ymd(r.fromDay).slice(0, 4), r.id))[type.id] ?? { used: 0, pending: 0 };
          if (u.used + r.days > type.daysPerYear) throw badRequest(`Only ${Math.max(0, type.daysPerYear - u.used)} ${type.name} days are left for this person this year.`);
        }
        if (!(await this.leave.transition(tx, id, { status: "pending" }, { status: b.status, decidedBy: tx.member.userId, decidedAt: new Date(), note: b.note || null }, sc))) throw conflict("This request was already handled.");
        return { ...r, typeName: type?.name ?? "Leave" };
      },
    });
    const span = `${ymd(done.fromDay)}${done.toDay > done.fromDay ? ` to ${ymd(done.toDay)}` : ""}`;
    await notify(ctx.db, [done.userId], { tenantId: ctx.business.id, type: "people", link: "/business/people", title: b.status === "approved" ? "Your leave was approved" : "Your leave was not approved", message: `${done.typeName}, ${span}.${b.note ? ` ${b.note}` : ""}` })
      .catch((err: unknown) => ctx.log.warn({ err }, "leave decision notification failed"));
    return { message: b.status === "approved" ? "Leave approved." : "Leave rejected." };
  }

  // ───── Monthly summary ─────

  async summary(ctx: BusinessContext, rawQuery: unknown) {
    if (!this.sees(ctx)) throw forbidden("Your role can't see everyone's attendance.");
    const scope = ctx.permissions.require(READ);
    const q = S.SummaryQuery.parse(rawQuery);
    const first = `${q.month}-01`, last = monthEnd(q.month);
    if (!valid(first)) throw badRequest("That month isn't valid.");
    const [people, recs, leaves, types] = await Promise.all([
      this.team.inView(ctx, ctx.branches.idsFor(scope)), this.attendance.between(ctx, scope, first, last), this.leave.approvedIn(ctx, scope, first, last), this.types.all(ctx),
    ]);
    const rows = people.map((p) => {
      const mine = recs.filter((r) => r.userId === p.userId);
      const leave: Record<string, number> = {};
      for (const l of leaves.filter((x) => x.userId === p.userId)) {
        const n = l.halfDay ? 0.5 : workDays(ymd(l.fromDay) < first ? first : ymd(l.fromDay), ymd(l.toDay) > last ? last : ymd(l.toDay));
        const name = types.find((t) => t.id === l.typeId)?.name ?? "Leave";
        leave[name] = (leave[name] ?? 0) + n;
      }
      return { userId: p.userId, name: p.name, daysPresent: new Set(mine.map((r) => ymd(r.day))).size, late: mine.filter((r) => r.late).length, leave, leaveTotal: Object.values(leave).reduce((s, n) => s + n, 0) };
    });
    return { month: q.month, types: types.filter((t) => t.active).map((t) => t.name), rows };
  }

  // ───── Settings: when the day starts ─────

  async saveSettings(ctx: BusinessContext, raw: unknown) {
    if (!this.manages(ctx)) throw forbidden("Your role can't change this.");
    const b = S.SettingsBody.parse(raw);
    await this.manage<{ branchId: null }>(ctx, {
      name: "settings", refusal: "Your role can't change this.",
      audit: () => ({ action: "people.settings", meta: b }),
      run: async (tx) => {
        const settings = await this.team.settings(tx);
        await this.team.saveSettings(tx, { ...settings, people: { ...((settings.people as object) ?? {}), workStart: b.workStart } });
        return { branchId: null };
      },
    });
  }
}
