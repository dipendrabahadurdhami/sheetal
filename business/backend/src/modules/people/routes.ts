// People: attendance and leave (Business → Team → Attendance, /business/people).
// Where it fits: LivePeople.jsx calls these; the owner and managers see everyone at their branches, everyone else only
// themselves.
// How it works: a person checks in and out for themselves (one open check-in at a time; the first check-in of a Nepal
// day is "late" when it is after the business's start time, default 10:00). Leave: types with days a year (Casual, Sick…
// are made on first use), a request that a manager approves or rejects (the person gets a bell), balances per year.
// Managers also see a board for a day (in, late, on leave, absent), fix or add a record with a reason, and a monthly
// summary per person. Saturday is the weekly off day: it is not counted as leave and nobody is "absent" on it (a check-in on Saturday still counts).
// Rules: everything stays inside the business and the branches in view; people.view sees, people.manage changes; you
// can't approve your own leave unless you own the business; every change is audited.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { notify, teamWith } from "@sheetal/backend-core/lib/notify";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { branchFor, branchesOf, branchView, inView, workspaceOf, type BranchView, type Workspace } from "../access.js";

const NEPAL_MS = 5.75 * 3_600_000;
const SATURDAY = 6;
const DEFAULT_START = "10:00";
const DEFAULT_TYPES = [["Casual", 6, true], ["Sick", 12, true], ["Home", 18, true], ["Festival", 4, true], ["Unpaid", 0, false]] as const;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-07.");
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:30.");
const Lat = z.number().min(-90).max(90).optional();
const Lng = z.number().min(-180).max(180).optional();

const nepalDayOf = (d: Date) => ymd(new Date(d.getTime() + NEPAL_MS));
const minutesOf = (d: Date) => { const n = new Date(d.getTime() + NEPAL_MS); return n.getUTCHours() * 60 + n.getUTCMinutes(); };
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const at = (day: string, hhmm: string) => new Date(dayOf(day).getTime() + toMinutes(hhmm) * 60_000 - NEPAL_MS);
const hhmm = (d: Date | null) => (d ? `${String(new Date(d.getTime() + NEPAL_MS).getUTCHours()).padStart(2, "0")}:${String(new Date(d.getTime() + NEPAL_MS).getUTCMinutes()).padStart(2, "0")}` : null);
const isOff = (day: string) => dayOf(day).getUTCDay() === SATURDAY;
const valid = (day: string) => !Number.isNaN(dayOf(day).getTime()) && ymd(dayOf(day)) === day;
/** A day (YYYY-MM-DD) some days later or earlier. */
const addDays = (day: string, n: number) => ymd(new Date(dayOf(day).getTime() + n * 86_400_000));
const days = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d); return out; };
const nameOf = (u: { userName: string; firstName: string | null; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.userName;
const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number) as [number, number]; return ymd(new Date(Date.UTC(y, mo, 0))); };

export async function peopleRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const audit = (ws: Workspace, ip: string, action: string, target?: string, meta?: object) =>
    db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip, meta: meta as object | undefined } });
  const sees = (ws: Workspace) => ws.can("people.view") || ws.can("people.manage");
  const manages = (ws: Workspace) => ws.can("people.manage");
  const owns = (ws: Workspace) => ws.member.role.perms.includes("*");

  /** The branch for the person's own check-in or leave: the one asked for or picked, else their first open branch. */
  const homeBranch = (v: BranchView, asked?: string | null) => {
    if (asked || v.pick) return branchFor(v, asked);
    const open = v.mine.find((b) => b.status === "open");
    if (!open) throw forbidden("You aren't given any open branch. Ask the owner to give you one on the Team page.");
    return open.id;
  };
  const workStart = async (tenantId: string) => {
    const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
    const v = ((t.settings ?? {}) as { people?: { workStart?: string } }).people?.workStart;
    return v && Time.safeParse(v).success ? v : DEFAULT_START;
  };
  const leaveTypes = async (tenantId: string) => {
    if (!(await db().leaveType.count({ where: { tenantId } }))) {
      await db().leaveType.createMany({ data: DEFAULT_TYPES.map(([name, daysPerYear, paid]) => ({ tenantId, name, daysPerYear, paid })), skipDuplicates: true });
    }
    return db().leaveType.findMany({ where: { tenantId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
  };
  /** Days taken (approved) and waiting (pending) per leave type, for one person and calendar year. */
  const usage = async (tenantId: string, userId: string, year: string, except?: string) => {
    const rows = await db().leaveRequest.findMany({ where: { tenantId, userId, status: { in: ["approved", "pending"] }, fromDay: { gte: dayOf(`${year}-01-01`), lte: dayOf(`${year}-12-31`) }, ...(except ? { id: { not: except } } : {}) }, select: { typeId: true, status: true, days: true } });
    const out: Record<string, { used: number; pending: number }> = {};
    for (const r of rows) { const o = (out[r.typeId] ??= { used: 0, pending: 0 }); if (r.status === "approved") o.used += r.days; else o.pending += r.days; }
    return out;
  };
  /** People of the business who work at a branch in view (owners and all-branch people at every branch). */
  const peopleInView = async (ws: Workspace, v: BranchView) => {
    const names = (v.ids ? v.mine.filter((b) => v.ids!.includes(b.id)) : v.mine).map((b) => b.name);
    const ms = await db().membership.findMany({ where: { tenantId: ws.tenantId, status: "active" }, include: { user: { select: { id: true, userName: true, firstName: true, lastName: true } }, role: { select: { key: true, perms: true } } } });
    return ms.filter((m) => { const b = branchesOf(m as never); return b === "all" || b.some((x) => names.includes(x)); })
      .map((m) => ({ userId: m.userId, name: nameOf(m.user), role: m.role.key }));
  };

  // ───── Me: today, balances, my leave ─────
  app.get("/people/me", async (request) => {
    const ws = workspaceOf(request);
    const today = nepalDay();
    const [open, todayRows, types, mine, start] = await Promise.all([
      db().attendance.findFirst({ where: { tenantId: ws.tenantId, userId: ws.user.id, outAt: null }, orderBy: { inAt: "desc" } }),
      db().attendance.findMany({ where: { tenantId: ws.tenantId, userId: ws.user.id, day: dayOf(today) }, orderBy: { inAt: "asc" } }),
      leaveTypes(ws.tenantId),
      db().leaveRequest.findMany({ where: { tenantId: ws.tenantId, userId: ws.user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
      workStart(ws.tenantId),
    ]);
    const used = await usage(ws.tenantId, ws.user.id, today.slice(0, 4));
    return { data: {
      today, workStart: start, canSee: sees(ws), canManage: manages(ws),
      open: open ? { id: open.id, day: ymd(open.day), inAt: hhmm(open.inAt), late: open.late } : null,
      records: todayRows.map((r) => ({ id: r.id, inAt: hhmm(r.inAt), outAt: hhmm(r.outAt), late: r.late })),
      balances: types.filter((t) => t.active).map((t) => ({ typeId: t.id, name: t.name, paid: t.paid, perYear: t.daysPerYear, used: used[t.id]?.used ?? 0, pending: used[t.id]?.pending ?? 0 })),
      leaves: mine.map((r) => ({ id: r.id, typeId: r.typeId, from: ymd(r.fromDay), to: ymd(r.toDay), days: r.days, halfDay: r.halfDay, reason: r.reason, status: r.status, note: r.note })),
    } };
  });

  // ───── Check in and out ─────
  app.post("/people/check-in", async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({ branchId: z.string().optional(), lat: Lat, lng: Lng, note: z.string().trim().max(200).optional() }).parse(request.body);
    const branchId = homeBranch(await branchView(db(), request, ws), b.branchId);
    if (await db().attendance.findFirst({ where: { tenantId: ws.tenantId, userId: ws.user.id, outAt: null }, select: { id: true } })) throw conflict("You are already checked in. Check out first.");
    const now = new Date(), day = nepalDayOf(now);
    const first = !(await db().attendance.count({ where: { tenantId: ws.tenantId, userId: ws.user.id, day: dayOf(day) } }));
    const late = first && minutesOf(now) > toMinutes(await workStart(ws.tenantId));
    const row = await db().attendance.create({ data: { tenantId: ws.tenantId, branchId, userId: ws.user.id, day: dayOf(day), inAt: now, inLat: b.lat, inLng: b.lng, late, note: b.note || null, source: "app" } });
    await audit(ws, request.ip, "people.check_in", row.id, { branchId, late });
    return { status: 200, message: late ? "Checked in (late)." : "Checked in.", data: { id: row.id, inAt: hhmm(row.inAt), late } };
  });

  app.post("/people/check-out", async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({ lat: Lat, lng: Lng }).parse(request.body ?? {});
    const open = await db().attendance.findFirst({ where: { tenantId: ws.tenantId, userId: ws.user.id, outAt: null }, orderBy: { inAt: "desc" } });
    if (!open) throw conflict("You aren't checked in.");
    const row = await db().attendance.update({ where: { id: open.id }, data: { outAt: new Date(), outLat: b.lat, outLng: b.lng } });
    await audit(ws, request.ip, "people.check_out", row.id);
    return { status: 200, message: "Checked out.", data: { id: row.id, outAt: hhmm(row.outAt) } };
  });

  // ───── Board: who is in, late, on leave or absent on a day ─────
  app.get("/people/board", async (request) => {
    const ws = workspaceOf(request);
    if (!sees(ws)) throw forbidden("Your role can't see everyone's attendance.");
    const q = z.object({ day: Day.optional() }).parse(request.query);
    const day = q.day ?? nepalDay();
    if (!valid(day)) throw badRequest("That date isn't valid.");
    const v = await branchView(db(), request, ws);
    const [people, recs, leaves] = await Promise.all([
      peopleInView(ws, v),
      db().attendance.findMany({ where: { tenantId: ws.tenantId, ...inView(v), day: dayOf(day) }, orderBy: { inAt: "asc" }, include: { branch: { select: { name: true } } } }),
      db().leaveRequest.findMany({ where: { tenantId: ws.tenantId, ...inView(v), status: "approved", fromDay: { lte: dayOf(day) }, toDay: { gte: dayOf(day) } }, select: { userId: true, typeId: true, halfDay: true } }),
    ]);
    const types = new Map((await leaveTypes(ws.tenantId)).map((t) => [t.id, t.name]));
    const off = isOff(day), future = day > nepalDay();
    const rows = people.map((p) => {
      const mine = recs.filter((r) => r.userId === p.userId), lv = leaves.find((l) => l.userId === p.userId);
      const status = mine.length ? (mine.some((r) => r.late) ? "late" : mine.every((r) => r.outAt) ? "out" : "in") : lv ? "leave" : off ? "off" : future ? "none" : "absent";
      return { ...p, status, leave: lv ? types.get(lv.typeId) ?? "Leave" : null, records: mine.map((r) => ({ id: r.id, inAt: hhmm(r.inAt), outAt: hhmm(r.outAt), late: r.late, source: r.source, branch: r.branch.name, note: r.note })) };
    });
    const n = (s: string) => rows.filter((r) => r.status === s).length;
    return { data: { day, off, counts: { present: rows.filter((r) => r.records.length).length, late: n("late"), leave: n("leave"), absent: n("absent"), total: rows.length }, rows } };
  });

  // ───── Fix or add a record ─────
  app.post("/people/attendance", async (request) => {
    const ws = workspaceOf(request);
    if (!manages(ws)) throw forbidden("Your role can't change attendance.");
    const b = z.object({ userId: z.string(), day: Day, inTime: Time, outTime: Time.optional(), branchId: z.string().optional(), reason: z.string().trim().min(3, "Say why.").max(300) }).parse(request.body);
    if (!valid(b.day) || b.day > nepalDay()) throw badRequest("Pick today or an earlier day.");
    if (b.outTime && b.outTime <= b.inTime) throw badRequest("Check-out must be after check-in.");
    if (!(await db().membership.findFirst({ where: { tenantId: ws.tenantId, userId: b.userId, status: "active" }, select: { id: true } }))) throw notFound("That person isn't in this team.");
    const branchId = branchFor(await branchView(db(), request, ws), b.branchId);
    const first = !(await db().attendance.count({ where: { tenantId: ws.tenantId, userId: b.userId, day: dayOf(b.day), inAt: { lt: at(b.day, b.inTime) } } }));
    const late = first && toMinutes(b.inTime) > toMinutes(await workStart(ws.tenantId));
    const row = await db().attendance.create({ data: { tenantId: ws.tenantId, branchId, userId: b.userId, day: dayOf(b.day), inAt: at(b.day, b.inTime), outAt: b.outTime ? at(b.day, b.outTime) : null, late, note: b.reason, source: "manual", editedBy: ws.user.id } });
    await audit(ws, request.ip, "people.attendance_add", row.id, { userId: b.userId, day: b.day, in: b.inTime, out: b.outTime ?? null, reason: b.reason });
    return { status: 201, message: "Record added.", data: { id: row.id } };
  });

  app.patch("/people/attendance/:id", async (request) => {
    const ws = workspaceOf(request);
    if (!manages(ws)) throw forbidden("Your role can't change attendance.");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const b = z.object({ inTime: Time.optional(), outTime: Time.nullable().optional(), reason: z.string().trim().min(3, "Say why.").max(300) }).parse(request.body);
    const v = await branchView(db(), request, ws);
    const r = await db().attendance.findFirst({ where: { id, tenantId: ws.tenantId, ...inView(v) } });
    if (!r) throw notFound("That record isn't here.");
    const day = ymd(r.day);
    const inTime = b.inTime ?? hhmm(r.inAt)!;
    const outTime = b.outTime === undefined ? hhmm(r.outAt) : b.outTime;
    if (outTime && outTime <= inTime) throw badRequest("Check-out must be after check-in.");
    const inAt = at(day, inTime), outAt = outTime ? at(day, outTime) : null;
    const late = r.late && b.inTime == null ? r.late : toMinutes(inTime) > toMinutes(await workStart(ws.tenantId)) && !(await db().attendance.count({ where: { tenantId: ws.tenantId, userId: r.userId, day: r.day, id: { not: r.id }, inAt: { lt: inAt } } }));
    await db().attendance.update({ where: { id }, data: { inAt, outAt, late, source: "manual", editedBy: ws.user.id, note: b.reason } });
    await audit(ws, request.ip, "people.attendance_fix", id, { userId: r.userId, day, before: { in: hhmm(r.inAt), out: hhmm(r.outAt) }, after: { in: inTime, out: outTime }, reason: b.reason });
    return { status: 200, message: "Record fixed." };
  });

  // ───── Leave types ─────
  app.get("/people/leave-types", async (request) => {
    const ws = workspaceOf(request);
    return { data: (await leaveTypes(ws.tenantId)).map((t) => ({ id: t.id, name: t.name, daysPerYear: t.daysPerYear, paid: t.paid, active: t.active })) };
  });
  const TypeBody = z.object({ name: z.string().trim().min(2, "Give it a name.").max(40), daysPerYear: z.number().int().min(0).max(366), paid: z.boolean() });
  app.post("/people/leave-types", async (request) => {
    const ws = workspaceOf(request);
    if (!manages(ws)) throw forbidden("Your role can't change leave types.");
    const b = TypeBody.parse(request.body);
    await leaveTypes(ws.tenantId);
    if (await db().leaveType.findUnique({ where: { tenantId_name: { tenantId: ws.tenantId, name: b.name } } })) throw conflict("There is already a leave type with that name.");
    const row = await db().leaveType.create({ data: { tenantId: ws.tenantId, ...b } });
    await audit(ws, request.ip, "people.leave_type_add", row.id, b);
    return { status: 201, message: "Leave type added.", data: { id: row.id } };
  });
  app.patch("/people/leave-types/:id", async (request) => {
    const ws = workspaceOf(request);
    if (!manages(ws)) throw forbidden("Your role can't change leave types.");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const b = TypeBody.partial().extend({ active: z.boolean().optional() }).parse(request.body);
    const t = await db().leaveType.findFirst({ where: { id, tenantId: ws.tenantId } });
    if (!t) throw notFound("That leave type isn't here.");
    if (b.name && b.name !== t.name && (await db().leaveType.findUnique({ where: { tenantId_name: { tenantId: ws.tenantId, name: b.name } } }))) throw conflict("There is already a leave type with that name.");
    await db().leaveType.update({ where: { id }, data: b });
    await audit(ws, request.ip, "people.leave_type_edit", id, b);
    return { status: 200, message: "Saved." };
  });

  // ───── Leave requests ─────
  app.get("/people/leave", async (request) => {
    const ws = workspaceOf(request);
    const q = z.object({ status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional() }).parse(request.query);
    if (!sees(ws)) return { data: [] };
    const v = await branchView(db(), request, ws);
    const rows = await db().leaveRequest.findMany({ where: { tenantId: ws.tenantId, ...inView(v), ...(q.status ? { status: q.status } : {}) }, orderBy: [{ status: "asc" }, { fromDay: "desc" }], take: 300 });
    const [users, types] = await Promise.all([
      db().user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, userName: true, firstName: true, lastName: true } }),
      leaveTypes(ws.tenantId),
    ]);
    return { data: rows.map((r) => ({ id: r.id, userId: r.userId, name: nameOf(users.find((u) => u.id === r.userId) ?? { userName: "Removed person", firstName: null, lastName: null }), type: types.find((t) => t.id === r.typeId)?.name ?? "Leave", from: ymd(r.fromDay), to: ymd(r.toDay), days: r.days, halfDay: r.halfDay, reason: r.reason, status: r.status, note: r.note })) };
  });

  app.post("/people/leave", async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({ typeId: z.string(), from: Day, to: Day, halfDay: z.boolean().default(false), reason: z.string().trim().max(300).optional(), branchId: z.string().optional() }).parse(request.body);
    if (!valid(b.from) || !valid(b.to)) throw badRequest("Those dates aren't valid.");
    if (b.to < b.from) throw badRequest("The last day is before the first day.");
    if (b.from < nepalDay()) throw badRequest("Leave can only start today or later. Ask a manager to fix past days.");
    if (b.halfDay && b.from !== b.to) throw badRequest("A half day is one day.");
    if (b.to > addDays(b.from, 60)) throw badRequest("Ask for up to 60 days at a time.");
    const type = (await leaveTypes(ws.tenantId)).find((t) => t.id === b.typeId && t.active);
    if (!type) throw badRequest("Pick a leave type.");
    const count = days(b.from, b.to).filter((d) => !isOff(d)).length;
    if (!count) throw badRequest("Saturday is the weekly off day; pick other days.");
    const n = b.halfDay ? 0.5 : count;
    if (await db().leaveRequest.findFirst({ where: { tenantId: ws.tenantId, userId: ws.user.id, status: { in: ["pending", "approved"] }, fromDay: { lte: dayOf(b.to) }, toDay: { gte: dayOf(b.from) } }, select: { id: true } })) throw conflict("You already have leave on some of these days.");
    if (type.daysPerYear > 0) {
      const u = (await usage(ws.tenantId, ws.user.id, b.from.slice(0, 4)))[type.id] ?? { used: 0, pending: 0 };
      const left = type.daysPerYear - u.used - u.pending;
      if (n > left) throw badRequest(`You have ${Math.max(0, left)} ${type.name} ${left === 1 ? "day" : "days"} left this year.`);
    }
    const branchId = homeBranch(await branchView(db(), request, ws), b.branchId);
    const row = await db().leaveRequest.create({ data: { tenantId: ws.tenantId, branchId, userId: ws.user.id, typeId: type.id, fromDay: dayOf(b.from), toDay: dayOf(b.to), days: n, halfDay: b.halfDay, reason: b.reason || null } });
    await audit(ws, request.ip, "people.leave_request", row.id, { type: type.name, from: b.from, to: b.to, days: n });
    const who = (await teamWith(db(), ws.tenantId, ["people.manage"], branchId)).filter((id) => id !== ws.user.id);
    await notify(db(), who, { tenantId: ws.tenantId, type: "people", title: `Leave request from ${nameOf(ws.user as never)}`, message: `${type.name}: ${b.from}${b.to !== b.from ? ` to ${b.to}` : ""} (${n} ${n === 1 ? "day" : "days"})`, link: "/business/people" });
    return { status: 201, message: "Leave requested.", data: { id: row.id } };
  });

  app.post("/people/leave/:id/cancel", async (request) => {
    const ws = workspaceOf(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const r = await db().leaveRequest.findFirst({ where: { id, tenantId: ws.tenantId, userId: ws.user.id } });
    if (!r) throw notFound("That request isn't here.");
    if (!["pending", "approved"].includes(r.status) || ymd(r.toDay) < nepalDay()) throw conflict("This leave can't be cancelled any more.");
    await db().leaveRequest.update({ where: { id }, data: { status: "cancelled" } });
    await audit(ws, request.ip, "people.leave_cancel", id);
    return { status: 200, message: "Leave cancelled." };
  });

  app.post("/people/leave/:id/decide", async (request) => {
    const ws = workspaceOf(request);
    if (!manages(ws)) throw forbidden("Your role can't approve leave.");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const b = z.object({ status: z.enum(["approved", "rejected"]), note: z.string().trim().max(300).optional() }).parse(request.body);
    const v = await branchView(db(), request, ws);
    const r = await db().leaveRequest.findFirst({ where: { id, tenantId: ws.tenantId, ...inView(v) } });
    if (!r) throw notFound("That request isn't here.");
    if (r.status !== "pending") throw conflict("This request was already handled.");
    if (r.userId === ws.user.id && !owns(ws)) throw forbidden("Ask another manager to decide your own leave.");
    const type = await db().leaveType.findFirst({ where: { id: r.typeId, tenantId: ws.tenantId } });
    if (b.status === "approved" && type && type.daysPerYear > 0) {
      const u = (await usage(ws.tenantId, r.userId, ymd(r.fromDay).slice(0, 4), r.id))[type.id] ?? { used: 0, pending: 0 };
      if (u.used + r.days > type.daysPerYear) throw badRequest(`Only ${Math.max(0, type.daysPerYear - u.used)} ${type.name} days are left for this person this year.`);
    }
    await db().leaveRequest.update({ where: { id }, data: { status: b.status, decidedBy: ws.user.id, decidedAt: new Date(), note: b.note || null } });
    await audit(ws, request.ip, b.status === "approved" ? "people.leave_approve" : "people.leave_reject", id, { userId: r.userId, note: b.note });
    const span = `${ymd(r.fromDay)}${r.toDay > r.fromDay ? ` to ${ymd(r.toDay)}` : ""}`;
    await notify(db(), [r.userId], { tenantId: ws.tenantId, type: "people", link: "/business/people", title: b.status === "approved" ? "Your leave was approved" : "Your leave was not approved", message: `${type?.name ?? "Leave"}, ${span}.${b.note ? ` ${b.note}` : ""}` });
    return { status: 200, message: b.status === "approved" ? "Leave approved." : "Leave rejected." };
  });

  // ───── Monthly summary ─────
  app.get("/people/summary", async (request) => {
    const ws = workspaceOf(request);
    if (!sees(ws)) throw forbidden("Your role can't see everyone's attendance.");
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).default(nepalDay().slice(0, 7)) }).parse(request.query);
    const first = `${q.month}-01`, last = monthEnd(q.month);
    if (!valid(first)) throw badRequest("That month isn't valid.");
    const v = await branchView(db(), request, ws);
    const [people, recs, leaves, types] = await Promise.all([
      peopleInView(ws, v),
      db().attendance.findMany({ where: { tenantId: ws.tenantId, ...inView(v), day: { gte: dayOf(first), lte: dayOf(last) } }, select: { userId: true, day: true, late: true } }),
      db().leaveRequest.findMany({ where: { tenantId: ws.tenantId, ...inView(v), status: "approved", fromDay: { lte: dayOf(last) }, toDay: { gte: dayOf(first) } } }),
      leaveTypes(ws.tenantId),
    ]);
    const rows = people.map((p) => {
      const mine = recs.filter((r) => r.userId === p.userId);
      const leave: Record<string, number> = {};
      for (const l of leaves.filter((x) => x.userId === p.userId)) {
        const n = l.halfDay ? 0.5 : days(ymd(l.fromDay) < first ? first : ymd(l.fromDay), ymd(l.toDay) > last ? last : ymd(l.toDay)).filter((d) => !isOff(d)).length;
        const name = types.find((t) => t.id === l.typeId)?.name ?? "Leave";
        leave[name] = (leave[name] ?? 0) + n;
      }
      return { userId: p.userId, name: p.name, daysPresent: new Set(mine.map((r) => ymd(r.day))).size, late: mine.filter((r) => r.late).length, leave, leaveTotal: Object.values(leave).reduce((s, n) => s + n, 0) };
    });
    return { data: { month: q.month, types: types.filter((t) => t.active).map((t) => t.name), rows } };
  });

  // ───── Settings: when the day starts ─────
  app.get("/people/settings", async (request) => {
    const ws = workspaceOf(request);
    return { data: { workStart: await workStart(ws.tenantId) } };
  });
  app.put("/people/settings", async (request) => {
    const ws = workspaceOf(request);
    if (!manages(ws)) throw forbidden("Your role can't change this.");
    const b = z.object({ workStart: Time }).parse(request.body);
    const t = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, select: { settings: true } });
    const settings = (t.settings ?? {}) as Record<string, unknown>;
    await db().tenant.update({ where: { id: ws.tenantId }, data: { settings: { ...settings, people: { ...((settings.people as object) ?? {}), workStart: b.workStart } } } });
    await audit(ws, request.ip, "people.settings", undefined, b);
    return { status: 200, message: "Saved." };
  });
}
