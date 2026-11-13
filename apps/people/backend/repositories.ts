// The only code that reads and writes the People tables (attendance, leave types, leave requests), plus the few team and business facts People reads.
// Where it fits: PeopleService calls these; nothing else in the repo touches these tables (KERNEL.md section 6).
// How it works: each repository extends BaseRepository, so every read carries this business, "not deleted" and the branches the person's data scope allows.
// A person's OWN rows (their check-ins, their leave) are read business-wide by user id: scope "all" plus userId, as before (a person sees their own records at
// every branch). The named methods below are the queries the old routes made, each built on scopeWhere().
// Rules: no hard delete. Default leave types are made on first use (createMany, skipDuplicates) so two first requests never make them twice.

import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import { BaseRepository } from "@sheetal/platform/core/repository";
import { accessOfMember } from "@sheetal/platform/tenancy/context";
import { actorIdOf } from "@sheetal/platform/core/context";
import { DEFAULT_TYPES, dayOf, nameOf } from "./time.js";
import type { AttendanceRow, LeaveRequestRow, LeaveTypeRow, TeamPerson, UserName } from "./types.js";

type Where = Record<string, unknown>;
interface Delegate {
  findFirst(args: object): Promise<unknown>;
  findMany(args: object): Promise<unknown[]>;
  count(args: object): Promise<number>;
  createMany(args: object): Promise<{ count: number }>;
}
type Tables = Record<"attendance" | "leaveType" | "leaveRequest" | "membership" | "user" | "tenant", Delegate> & {
  tenant: Delegate & { update(args: object): Promise<unknown> };
};
const tables = (ctx: BusinessContext): Tables => (ctx.tx ?? ctx.db) as unknown as Tables;

// ───── Attendance ─────

export class AttendanceRepository extends BaseRepository<AttendanceRow, Partial<AttendanceRow>, Partial<AttendanceRow>> {
  constructor() {
    super({
      model: "attendance", ownerField: "userId", label: "This record",
      filterable: { userId: ["eq"], day: ["eq", "between"], late: ["eq"] },
      sortable: ["inAt", "day"], defaultSort: [{ field: "inAt", dir: "asc" }],
    });
  }
  private async mine(ctx: BusinessContext, userId: string, more: Where = {}): Promise<Where> {
    return { AND: [await this.scopeWhere(ctx, "all"), { userId }, more] };
  }
  /** The person's open check-in (no check-out yet), newest first. */
  async openOf(ctx: BusinessContext, userId: string): Promise<AttendanceRow | null> {
    return (await tables(ctx).attendance.findFirst({ where: await this.mine(ctx, userId, { outAt: null }), orderBy: { inAt: "desc" } })) as AttendanceRow | null;
  }
  async ofDay(ctx: BusinessContext, userId: string, day: string): Promise<AttendanceRow[]> {
    return (await tables(ctx).attendance.findMany({ where: await this.mine(ctx, userId, { day: dayOf(day) }), orderBy: { inAt: "asc" } })) as AttendanceRow[];
  }
  /** How many records the person has on a day (optionally only those that started before a moment, or other than one record). */
  async countOfDay(ctx: BusinessContext, userId: string, day: string, o: { before?: Date; except?: string } = {}): Promise<number> {
    return tables(ctx).attendance.count({ where: await this.mine(ctx, userId, { day: dayOf(day), ...(o.before ? { inAt: { lt: o.before } } : {}), ...(o.except ? { id: { not: o.except } } : {}) }) });
  }
  /** Records in the person's branch view on one day, with the branch name. */
  async board(ctx: BusinessContext, scope: DataScope, day: string): Promise<(AttendanceRow & { branch: { name: string } })[]> {
    return (await tables(ctx).attendance.findMany({ where: await this.scopeWhere(ctx, scope).then((w) => ({ AND: [w, { day: dayOf(day) }] })), orderBy: { inAt: "asc" }, include: { branch: { select: { name: true } } } })) as never;
  }
  /** Records in view between two days (the monthly summary). */
  async between(ctx: BusinessContext, scope: DataScope, first: string, last: string): Promise<Pick<AttendanceRow, "userId" | "day" | "late">[]> {
    return (await tables(ctx).attendance.findMany({ where: { AND: [await this.scopeWhere(ctx, scope), { day: { gte: dayOf(first), lte: dayOf(last) } }] }, select: { userId: true, day: true, late: true } })) as never;
  }
}

// ───── Leave types (business-wide) ─────

export class LeaveTypeRepository extends BaseRepository<LeaveTypeRow, Partial<LeaveTypeRow>, Partial<LeaveTypeRow>> {
  constructor() {
    super({
      model: "leaveType", branchField: null, ownerField: null, label: "This leave type",
      filterable: { active: ["eq"] }, sortable: ["active", "createdAt"],
      defaultSort: [{ field: "active", dir: "desc" }, { field: "createdAt", dir: "asc" }],
    });
  }
  /** Every leave type of the business; the defaults are made on first use. */
  async all(ctx: BusinessContext): Promise<LeaveTypeRow[]> {
    const t = tables(ctx);
    const where = await this.scopeWhere(ctx, "all");
    if (!(await t.leaveType.count({ where: { tenantId: ctx.business.id } }))) {
      const me = actorIdOf(ctx);
      await t.leaveType.createMany({ data: DEFAULT_TYPES.map(([name, daysPerYear, paid]) => ({ tenantId: ctx.business.id, name, daysPerYear, paid, createdBy: me, updatedBy: me })), skipDuplicates: true });
    }
    return (await t.leaveType.findMany({ where, orderBy: [{ active: "desc" }, { createdAt: "asc" }, { id: "asc" }] })) as LeaveTypeRow[];
  }
  /** The leave type with this name (names are unique in a business, deleted or not, because of the table's unique key). */
  async byName(ctx: BusinessContext, name: string): Promise<LeaveTypeRow | null> {
    return (await tables(ctx).leaveType.findFirst({ where: { tenantId: ctx.business.id, name } })) as LeaveTypeRow | null;
  }
}

// ───── Leave requests ─────

export class LeaveRequestRepository extends BaseRepository<LeaveRequestRow, Partial<LeaveRequestRow>, Partial<LeaveRequestRow>> {
  constructor() {
    super({
      model: "leaveRequest", ownerField: "userId", label: "This request",
      filterable: { status: ["eq"], userId: ["eq"] }, sortable: ["status", "fromDay", "createdAt"],
      defaultSort: [{ field: "status", dir: "asc" }, { field: "fromDay", dir: "desc" }],
      legacyMaxRows: 300,
    });
  }
  async mineRecent(ctx: BusinessContext, userId: string): Promise<LeaveRequestRow[]> {
    return (await tables(ctx).leaveRequest.findMany({ where: { AND: [await this.scopeWhere(ctx, "all"), { userId }] }, orderBy: { createdAt: "desc" }, take: 30 })) as LeaveRequestRow[];
  }
  /** One of the person's own requests, at any branch. */
  async mineOne(ctx: BusinessContext, userId: string, id: string): Promise<LeaveRequestRow | null> {
    return (await tables(ctx).leaveRequest.findFirst({ where: { AND: [await this.scopeWhere(ctx, "all"), { userId, id }] } })) as LeaveRequestRow | null;
  }
  /** Days taken (approved) and waiting (pending) per leave type, for one person and calendar year. */
  async usage(ctx: BusinessContext, userId: string, year: string, except?: string): Promise<Record<string, { used: number; pending: number }>> {
    const rows = (await tables(ctx).leaveRequest.findMany({
      where: { AND: [await this.scopeWhere(ctx, "all"), { userId, status: { in: ["approved", "pending"] }, fromDay: { gte: dayOf(`${year}-01-01`), lte: dayOf(`${year}-12-31`) }, ...(except ? { id: { not: except } } : {}) }] },
      select: { typeId: true, status: true, days: true },
    })) as { typeId: string; status: string; days: number }[];
    const out: Record<string, { used: number; pending: number }> = {};
    for (const r of rows) { const o = (out[r.typeId] ??= { used: 0, pending: 0 }); if (r.status === "approved") o.used += r.days; else o.pending += r.days; }
    return out;
  }
  /** Whether the person already has pending or approved leave touching these days. */
  async overlaps(ctx: BusinessContext, userId: string, from: string, to: string): Promise<boolean> {
    return !!(await tables(ctx).leaveRequest.findFirst({ where: { AND: [await this.scopeWhere(ctx, "all"), { userId, status: { in: ["pending", "approved"] }, fromDay: { lte: dayOf(to) }, toDay: { gte: dayOf(from) } }] }, select: { id: true } }));
  }
  /** Approved leave in view that touches the days from `first` to `last`. */
  async approvedIn(ctx: BusinessContext, scope: DataScope, first: string, last: string): Promise<LeaveRequestRow[]> {
    return (await tables(ctx).leaveRequest.findMany({ where: { AND: [await this.scopeWhere(ctx, scope), { status: "approved", fromDay: { lte: dayOf(last) }, toDay: { gte: dayOf(first) } }] } })) as LeaveRequestRow[];
  }
}

// ───── The team and the business (read, plus the business's People setting) ─────

export class TeamDirectory {
  /** People of the business who work at a branch in view (owners and all-branch people at every branch). `ids` null = the whole business. */
  async inView(ctx: BusinessContext, ids: readonly string[] | null): Promise<TeamPerson[]> {
    const visible = ids ?? ctx.branches.mine.map((b) => b.id);
    const ms = (await tables(ctx).membership.findMany({
      where: { tenantId: ctx.business.id, status: "active" },
      include: { user: { select: { id: true, userName: true, firstName: true, lastName: true } }, role: { select: { key: true, perms: true } }, branches: { select: { branchId: true } } },
    })) as { userId: string; scopes: unknown; allBranches: boolean; branches: { branchId: string }[]; user: UserName; role: { key: string; perms: string[] } }[];
    return ms
      .filter((m) => { const a = accessOfMember(m).allowed; return a === "all" || a.some((id) => visible.includes(id)); })
      .map((m) => ({ userId: m.userId, name: nameOf(m.user), role: m.role.key }));
  }
  async isActiveMember(ctx: BusinessContext, userId: string): Promise<boolean> {
    return !!(await tables(ctx).membership.findFirst({ where: { tenantId: ctx.business.id, userId, status: "active" }, select: { id: true } }));
  }
  async users(ctx: BusinessContext, ids: readonly string[]): Promise<UserName[]> {
    return (await tables(ctx).user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, userName: true, firstName: true, lastName: true } })) as UserName[];
  }
  /** The business's settings JSON (People keeps `people.workStart` in it, as before). */
  async settings(ctx: BusinessContext): Promise<Record<string, unknown>> {
    const t = (await tables(ctx).tenant.findFirst({ where: { id: ctx.business.id }, select: { settings: true } })) as { settings: unknown } | null;
    return ((t?.settings ?? {}) as Record<string, unknown>);
  }
  async saveSettings(ctx: BusinessContext, settings: Record<string, unknown>): Promise<void> {
    await tables(ctx).tenant.update({ where: { id: ctx.business.id }, data: { settings } });
  }
}
