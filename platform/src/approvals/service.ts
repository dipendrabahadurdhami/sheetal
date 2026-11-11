// Maker-checker approvals: one person asks, a DIFFERENT person decides, and only then does the action happen (ACCESS.md section 9).
// Where it fits: BaseService.action({ approval }) calls intercept() before it runs an action (core/service.ts); the Approvals inbox, the rules screen and the
// expiry job call the rest (approvals/routes.ts, approvals/jobs.ts). Apps register what to run after approval with register().
// How it works:
//   intercept()  looks up the rule for the action (the business's ApprovalRule row, or the manifest's default). No rule, rule off, amount under the limit, or
//                fewer than two people who could approve -> null (the action runs now; the last case is written to the audit log as "approval.skipped").
//                Otherwise it stores an ApprovalRequest with the validated input, tells the approvers, and the service answers 202 "Sent for approval.".
//   approve()    checks the checker (not the maker, holds the approver permission, covers the branch, not a support session), takes the request with ONE
//                compare-and-set (pending -> approved, still unexpired), then runs the registered executor as the MAKER (their role, their branches, ctx.approval set so
//                the action is not held again). Done -> executed; a rule failed -> failed; both people are told.
//   reject(), cancel()  the same compare-and-set to rejected / cancelled (only the maker cancels).
//   expirePending()  the job: pending requests past their time become expired and the maker is told.
// Rules: every rule in Phase 1 is OFF (the manifests' enabledByDefault is false and no ApprovalRule row is created), so nothing changes today; no Expenses or
// Reviews action names an `approval` yet (Phase 2 apps switch rules on). A rule can be made stricter by the business, never weaker than the manifest says
// (enabledByDefault true = required). Money is in paisa. Nothing here reads another business's rows: every query carries the tenant id.

import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError, badRequest, conflict, forbidden, notFound } from "../core/errors.js";
import type { ApprovalGate, ApprovalSpec } from "../core/approval.js";
import type { BusinessContext } from "../core/context.js";
import type { ApprovalDecl, AppManifest } from "../core/manifest.js";
import type { Db } from "../db/client.js";
import { notify, teamWith } from "../notify/index.js";
import { APPS } from "../tenancy/apps.generated.js";
import { reconcileOldNames } from "../tenancy/branch-links.js";
import { buildBusinessContext, type TenancyDeps } from "../tenancy/context.js";
import { PERMISSION_CATALOG } from "../tenancy/permissions.generated.js";

export type ApprovalStatus = "pending" | "approved" | "executed" | "failed" | "rejected" | "cancelled" | "expired";

/** Where the screens send people from a notification (the Approvals inbox of the business panel). */
export const APPROVALS_LINK = "/business/approvals";

export type Executor = (ctx: BusinessContext, payload: unknown) => Promise<unknown>;

export interface EffectiveRule {
  action: string;
  enabled: boolean;
  /** Paisa. Under it the action runs straight away. null = every time. */
  thresholdPaisa: bigint | null;
  approverPermission: string;
  expiresHours: number;
  /** true = the manifest requires it: the business cannot switch it off. */
  required: boolean;
}

interface RuleRow { enabled: boolean; thresholdPaisa: bigint | null; approverPermission: string; expiresHours: number }
type Manifests = readonly Pick<AppManifest, "id" | "approvals">[];

// ───────────── Pure rules (tested without a database) ─────────────

/** The manifest entry for an action, with the app that declares it. */
export function declOf(manifests: Manifests, action: string): { appId: string; decl: ApprovalDecl } | null {
  for (const m of manifests) {
    const decl = m.approvals.find((d) => d.action === action);
    if (decl) return { appId: m.id, decl };
  }
  return null;
}

/** The rule in force: the business's row on top of the manifest. No manifest entry and no row = the action is not approvable (null). */
export function effectiveRule(decl: ApprovalDecl | null, row: RuleRow | null, action: string): EffectiveRule | null {
  if (!decl && !row) return null;
  const required = !!decl?.enabledByDefault;
  return {
    action,
    // A required approval stays on whatever the row says; otherwise the row decides, and with no row the manifest default (off in Phase 1).
    enabled: required || (row ? row.enabled : false),
    thresholdPaisa: row ? row.thresholdPaisa : null,
    approverPermission: row?.approverPermission ?? decl?.approverPermission ?? action,
    expiresHours: row?.expiresHours ?? 72,
    required,
  };
}

/** Does this rule hold an action of this amount? A rule with a limit holds an action whose amount is not known (the safe side). */
export function needsApproval(rule: EffectiveRule | null, amountPaisa: number | undefined): boolean {
  if (!rule || !rule.enabled) return false;
  if (rule.thresholdPaisa === null) return true;
  if (amountPaisa === undefined) return true;
  return BigInt(amountPaisa) >= rule.thresholdPaisa;
}

/** Why this person may not decide a request, or null when they may. The order is the order of the messages people should see. */
export function deciderProblem(o: { makerId: string; deciderId: string; holdsApproverPermission: boolean; impersonating: boolean }): AppError | null {
  if (o.impersonating) return forbidden("A support session can't decide approvals.");
  if (o.makerId === o.deciderId) return forbidden("You can't decide your own request. Another person must.");
  if (!o.holdsApproverPermission) return forbidden("Your role can't decide this request.");
  return null;
}

const RuleBody = z.object({
  action: z.string().min(3).max(120),
  enabled: z.boolean(),
  /** Whole rupees; null or missing = every time. */
  thresholdRupees: z.number().min(0).max(100_000_000_000).nullish(),
  approverPermission: z.string().min(3).max(120).optional(),
  expiresHours: z.number().int().min(1).max(720).optional(),
}).strict();

/** JSON that fits in the result column: BigInt as text, and nothing big. */
function safeJson(v: unknown): Prisma.InputJsonValue | undefined {
  try {
    const s = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    if (s === undefined || s.length > 4000) return undefined;
    return JSON.parse(s) as Prisma.InputJsonValue;
  } catch { return undefined; }
}

const labelOf = (manifests: Manifests, action: string) => declOf(manifests, action)?.decl.label.en ?? action;

// ───────────── The service ─────────────

export interface ApprovalServiceOptions {
  /** What buildBusinessContext needs from backend-core (effectiveLimits), to run an approved action as the maker. */
  tenancy: TenancyDeps;
  /** The apps' manifests. Default: all of them (APPS). Tests pass their own. */
  manifests?: Manifests;
}

export class ApprovalService implements ApprovalGate {
  private readonly executors = new Map<string, Executor>();
  private readonly manifests: Manifests;
  constructor(private readonly o: ApprovalServiceOptions) { this.manifests = o.manifests ?? APPS; }

  /** An app says what runs for an action once it is approved. The context is the MAKER's; `payload` is what the service handed to intercept(). */
  register(action: string, run: Executor): void {
    if (this.executors.has(action)) throw new Error(`An executor for "${action}" is already registered.`);
    this.executors.set(action, run);
  }

  // ── Rules ──

  private async rule(db: Db, tenantId: string, action: string): Promise<EffectiveRule | null> {
    const row = await db.approvalRule.findUnique({ where: { tenantId_action: { tenantId, action } } });
    return effectiveRule(declOf(this.manifests, action)?.decl ?? null, row, action);
  }

  /** The permission that decides an action, even when its rule is off now (old requests must stay decidable). */
  private async approverOf(db: Db, tenantId: string, action: string): Promise<string | null> {
    return (await this.rule(db, tenantId, action))?.approverPermission ?? null;
  }

  // ── The gate ──

  async intercept(ctx: BusinessContext, spec: ApprovalSpec): Promise<{ approvalId: string } | null> {
    const db = ctx.db;
    const rule = await this.rule(db, ctx.business.id, spec.action);
    if (!rule || !needsApproval(rule, spec.amount?.paisa)) return null;
    // A support session may not ask: its maker would have to be a member who can be asked to run the action later.
    if (ctx.impersonation) throw forbidden("This needs a second person's approval, which a support session can't ask for.");

    const makerId = ctx.member.userId;
    const approvers = [...new Set(await teamWith(db, ctx.business.id, [rule.approverPermission], spec.branchId ?? null))];
    if (approvers.length < 2) {
      // One-person business (ACCESS.md 9.4): the rule only applies when two people could decide. Said plainly in the log.
      await this.audit(db, ctx, "approval.skipped", labelOf(this.manifests, spec.action), { action: spec.action, reason: "no second approver" });
      return null;
    }
    if (spec.resourceId) {
      const open = await db.approvalRequest.findFirst({ where: { tenantId: ctx.business.id, action: spec.action, resourceId: spec.resourceId, status: "pending" }, select: { id: true } });
      if (open) throw conflict("This is already waiting for approval.");
    }
    const created = await db.$transaction(async (tx) => {
      const row = await tx.approvalRequest.create({
        data: {
          tenantId: ctx.business.id, branchId: spec.branchId ?? null, action: spec.action,
          resource: spec.resource ?? spec.action.split(".")[1] ?? "item", resourceId: spec.resourceId ?? null,
          payload: (spec.payload ?? null) as Prisma.InputJsonValue, amountPaisa: spec.amount ? BigInt(spec.amount.paisa) : null,
          status: "pending", makerId, makerNote: (spec.note ?? "").slice(0, 300), expiresAt: new Date(ctx.now.getTime() + rule.expiresHours * 3_600_000),
        },
      });
      await tx.auditLog.create({
        data: { tenantId: ctx.business.id, actorId: makerId, action: "approval.requested", target: labelOf(this.manifests, spec.action), ip: ctx.ip, meta: { approvalId: row.id, action: spec.action, resourceId: spec.resourceId ?? null } },
      });
      return row;
    });
    const makerName = ctx.actor.kind === "user" ? ctx.actor.name : "Someone";
    await this.tell(ctx, approvers.filter((id) => id !== makerId), `Approval needed: ${labelOf(this.manifests, spec.action)}`, `${makerName} is waiting for you to decide.`);
    return { approvalId: created.id };
  }

  // ── The inbox ──

  async list(ctx: BusinessContext, q: { status?: "pending" | "decided" | "all" } = {}) {
    const db = ctx.db;
    const tenantId = ctx.business.id;
    const me = ctx.member.userId;
    const status = q.status ?? "pending";
    const rows = await db.approvalRequest.findMany({
      where: { tenantId, ...(status === "pending" ? { status: "pending" } : status === "decided" ? { status: { not: "pending" } } : {}) },
      orderBy: { createdAt: "desc" }, take: 200,
    });
    const approver = new Map<string, string | null>();
    for (const a of new Set(rows.map((r) => r.action))) approver.set(a, await this.approverOf(db, tenantId, a));
    /** Holds the permission that decides this action, at a branch they cover. */
    const covers = (r: { action: string; branchId: string | null }) => {
      const perm = approver.get(r.action);
      return !!perm && ctx.permissions.can(perm) && ctx.branches.canSee(r.branchId);
    };
    const canDecide = (r: { action: string; makerId: string; branchId: string | null }) => r.makerId !== me && !ctx.impersonation && covers(r);
    // People see their own requests, the ones they decided, and the ones they could decide.
    const shown = rows.filter((r) => r.makerId === me || r.checkerId === me || covers(r));
    const ids = [...new Set(shown.flatMap((r) => [r.makerId, r.checkerId].filter((x): x is string => !!x)))];
    const names = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, userName: true } }) : []).map((u) => [u.id, u.userName]));
    const person = (id: string | null) => (id ? { id, name: names.get(id) ?? "Someone" } : null);
    const out = shown.map((r) => ({
      id: r.id, action: r.action, label: labelOf(this.manifests, r.action), resource: r.resource, resourceId: r.resourceId, branchId: r.branchId,
      amountPaisa: r.amountPaisa === null ? null : Number(r.amountPaisa), amount: r.amountPaisa === null ? null : Number(r.amountPaisa) / 100,
      status: r.status as ApprovalStatus, maker: person(r.makerId), makerNote: r.makerNote, checker: person(r.checkerId), checkerNote: r.checkerNote,
      createdAt: r.createdAt, expiresAt: r.expiresAt, decidedAt: r.decidedAt, executedAt: r.executedAt,
      /** Why it failed or what it did, in words (never the stored input). */
      outcome: (r.result as { message?: string } | null)?.message ?? null,
      mine: r.makerId === me, canDecide: r.status === "pending" && canDecide(r), canCancel: r.status === "pending" && r.makerId === me && !ctx.impersonation,
    }));
    return { rows: out, counts: { toDecide: out.filter((r) => r.canDecide).length }, rulesOn: (await this.rules(ctx)).some((r) => r.enabled) };
  }

  // ── Deciding ──

  async approve(ctx: BusinessContext, id: string, note?: string) {
    const row = await this.checked(ctx, id);
    await this.take(ctx, row, "approved", note);
    const done = await this.execute(ctx, row);
    return { status: done.status as ApprovalStatus, message: done.status === "executed" ? "Approved and done." : `Approved, but it could not be completed: ${done.message}` };
  }

  async reject(ctx: BusinessContext, id: string, note?: string) {
    const row = await this.checked(ctx, id);
    await this.take(ctx, row, "rejected", note);
    await this.tell(ctx, [row.makerId], `Not approved: ${labelOf(this.manifests, row.action)}`, note ? `Reason: ${note.slice(0, 200)}` : "It was not approved.");
    return { status: "rejected" as const, message: "Rejected." };
  }

  /** Only the person who asked can take the request back. */
  async cancel(ctx: BusinessContext, id: string) {
    if (ctx.impersonation) throw forbidden("A support session can't change approvals.");
    const row = await this.load(ctx, id);
    if (row.makerId !== ctx.member.userId) throw forbidden("Only the person who asked can cancel it.");
    const done = await ctx.db.$transaction(async (tx) => {
      const r = await tx.approvalRequest.updateMany({ where: { id: row.id, tenantId: ctx.business.id, status: "pending" }, data: { status: "cancelled", decidedAt: ctx.now } });
      if (r.count !== 1) return false;
      await tx.auditLog.create({ data: { tenantId: ctx.business.id, actorId: ctx.member.userId, action: "approval.cancelled", target: labelOf(this.manifests, row.action), ip: ctx.ip, meta: { approvalId: row.id } } });
      return true;
    });
    if (!done) throw conflict("This request was already decided.");
    return { status: "cancelled" as const, message: "Request cancelled." };
  }

  private async load(ctx: BusinessContext, id: string) {
    const row = await ctx.db.approvalRequest.findFirst({ where: { id, tenantId: ctx.business.id } });
    if (!row) throw notFound("Request not found.");
    return row;
  }

  /** The request, after the checks on the person deciding it. A branch the person does not cover is "not found". */
  private async checked(ctx: BusinessContext, id: string) {
    const row = await this.load(ctx, id);
    const perm = await this.approverOf(ctx.db, ctx.business.id, row.action);
    const problem = deciderProblem({ makerId: row.makerId, deciderId: ctx.member.userId, holdsApproverPermission: !!perm && ctx.permissions.can(perm), impersonating: !!ctx.impersonation });
    if (problem) throw problem;
    if (!ctx.branches.canSee(row.branchId)) throw notFound("Request not found.");
    return row;
  }

  /** pending -> approved | rejected, once: the update only matches a request that is still pending and not expired, so two people deciding at once decide once. */
  private async take(ctx: BusinessContext, row: { id: string; action: string; makerId: string }, status: "approved" | "rejected", note?: string): Promise<void> {
    const took = await ctx.db.$transaction(async (tx) => {
      const r = await tx.approvalRequest.updateMany({
        where: { id: row.id, tenantId: ctx.business.id, status: "pending", expiresAt: { gt: ctx.now } },
        data: { status, checkerId: ctx.member.userId, checkerNote: note?.slice(0, 300) ?? null, decidedAt: ctx.now },
      });
      if (r.count !== 1) return false;
      await tx.auditLog.create({
        data: { tenantId: ctx.business.id, actorId: ctx.member.userId, action: `approval.${status === "approved" ? "approved" : "rejected"}`, target: labelOf(this.manifests, row.action), ip: ctx.ip, meta: { approvalId: row.id, makerId: row.makerId } },
      });
      return true;
    });
    if (took) return;
    const now = await this.load(ctx, row.id);
    throw conflict(now.status === "pending" ? "This request has expired." : "Someone already decided this request.");
  }

  /** Runs the registered executor as the maker. A rule that fails now (the world changed) ends as "failed", with the reason, and both people are told. */
  private async execute(ctx: BusinessContext, row: { id: string; action: string; makerId: string; branchId: string | null; payload: unknown }) {
    let status: "executed" | "failed" = "executed";
    let result: Prisma.InputJsonValue = { ok: true };
    let message = "";
    try {
      const run = this.executors.get(row.action);
      if (!run) throw new AppError(500, "no_executor", "This action can't be completed automatically.");
      const maker = await this.makerContext(ctx, row);
      const out = await run(maker, row.payload);
      const data = safeJson(out);
      result = data === undefined ? { ok: true } : { ok: true, data };
    } catch (err) {
      status = "failed";
      message = err instanceof AppError ? err.message : "Something went wrong while doing it.";
      if (!(err instanceof AppError)) ctx.log.error({ err, approvalId: row.id }, "approved action failed");
      result = { ok: false, message };
    }
    await ctx.db.approvalRequest.updateMany({ where: { id: row.id, tenantId: ctx.business.id, status: "approved" }, data: { status, executedAt: ctx.now, result } });
    if (status === "failed") {
      await this.audit(ctx.db, ctx, "approval.failed", labelOf(this.manifests, row.action), { approvalId: row.id, reason: message });
      await this.tell(ctx, [row.makerId, ctx.member.userId], `Could not be completed: ${labelOf(this.manifests, row.action)}`, message);
    } else {
      await this.tell(ctx, [row.makerId], `Approved: ${labelOf(this.manifests, row.action)}`, "It is done.");
    }
    return { status, message };
  }

  /** The maker's own context (their role, their branches), with ctx.approval set so the action's audit row carries both ids and it is not held again. */
  private async makerContext(ctx: BusinessContext, row: { id: string; makerId: string; branchId: string | null }): Promise<BusinessContext> {
    const m = await ctx.db.membership.findFirst({
      where: { tenantId: ctx.business.id, userId: row.makerId, status: "active" },
      include: {
        tenant: { include: { plan: true, branches: { select: { id: true, name: true } } } }, role: true,
        branches: { select: { branchId: true, branch: { select: { name: true } } } }, user: { select: { id: true, userName: true } },
      },
    });
    if (!m) throw new AppError(409, "maker_gone", "The person who asked is no longer in this business.");
    const { user, ...membership } = m;
    return buildBusinessContext({
      db: ctx.db, log: ctx.log, ip: ctx.ip, requestId: ctx.requestId, now: ctx.now,
      headers: { "x-tenant-id": ctx.business.id, ...(row.branchId ? { "x-branch": row.branchId } : {}) },
      user: { id: user.id, userName: user.userName, platformRole: null, memberships: [reconcileOldNames(membership, membership.tenant.branches)] },
      approval: { id: row.id, checkerId: ctx.member.userId },
    }, this.o.tenancy);
  }

  // ── The rules screen ──

  /** Every approvable action of the apps this business has, with the rule in force. */
  async rules(ctx: BusinessContext) {
    const rows = await ctx.db.approvalRule.findMany({ where: { tenantId: ctx.business.id } });
    const byAction = new Map(rows.map((r) => [r.action, r]));
    const out = [];
    for (const m of this.manifests) {
      if (m.id === "platform" || !ctx.entitlements.hasApp(m.id)) continue;
      for (const decl of m.approvals) {
        const rule = effectiveRule(decl, byAction.get(decl.action) ?? null, decl.action)!;
        const holders = new Set(await teamWith(ctx.db, ctx.business.id, [rule.approverPermission]));
        out.push({
          action: decl.action, app: m.id, label: decl.label.en, money: decl.money, required: rule.required, enabled: rule.enabled,
          thresholdRupees: rule.thresholdPaisa === null ? null : Number(rule.thresholdPaisa) / 100,
          approverPermission: rule.approverPermission, expiresHours: rule.expiresHours,
          /** How many people could decide it. Under two, the rule does not hold anything (a hint for the screen). */
          approvers: holders.size,
        });
      }
    }
    return out;
  }

  async setRule(ctx: BusinessContext, raw: unknown) {
    if (ctx.impersonation) throw forbidden("A support session can't change approvals.");
    ctx.permissions.require("workspace.settings.update", "Your role can't change approval rules.");
    const b = RuleBody.parse(raw);
    const found = declOf(this.manifests, b.action);
    if (!found || found.appId === "platform" || !ctx.entitlements.hasApp(found.appId)) throw badRequest("That action can't have an approval rule.");
    if (found.decl.enabledByDefault && !b.enabled) throw badRequest("Sheetal requires this approval; it can't be switched off.");
    const approverPermission = b.approverPermission ?? found.decl.approverPermission;
    const info = PERMISSION_CATALOG.find((p) => p.id === approverPermission);
    if (!info || info.app === "platform" || !ctx.entitlements.hasApp(info.app)) throw badRequest("Choose who approves from the permissions of your apps.");
    const thresholdPaisa = b.thresholdRupees === null || b.thresholdRupees === undefined ? null : BigInt(Math.round(b.thresholdRupees * 100));
    const data = { enabled: b.enabled, thresholdPaisa, approverPermission, expiresHours: b.expiresHours ?? 72 };
    await ctx.db.$transaction(async (tx) => {
      await tx.approvalRule.upsert({
        where: { tenantId_action: { tenantId: ctx.business.id, action: b.action } },
        create: { tenantId: ctx.business.id, action: b.action, ...data }, update: data,
      });
      await tx.auditLog.create({
        data: { tenantId: ctx.business.id, actorId: ctx.member.userId, action: "approval.rule_changed", target: found.decl.label.en, ip: ctx.ip, meta: { action: b.action, enabled: b.enabled, thresholdRupees: b.thresholdRupees ?? null, approverPermission } },
      });
    });
    return (await this.rules(ctx)).find((r) => r.action === b.action)!;
  }

  // ── Small helpers ──

  private async audit(db: Db, ctx: BusinessContext, action: string, target: string, meta?: object) {
    await db.auditLog.create({ data: { tenantId: ctx.business.id, actorId: ctx.member.userId, action, target, ip: ctx.ip, ...(meta ? { meta: meta as Prisma.InputJsonValue } : {}) } });
  }

  /** The bell. A failed notification is logged and never undoes a decision. */
  private async tell(ctx: BusinessContext, userIds: string[], title: string, message: string) {
    await notify(ctx.db, userIds, { type: "approval", title, message, link: APPROVALS_LINK, tenantId: ctx.business.id })
      .catch((err: unknown) => ctx.log.warn({ err }, "approval notification failed"));
  }
}

// ───────────── The expiry job ─────────────

/** Pending requests whose time has passed become "expired" and the maker is told. Safe to run twice and from two processes: each request is taken once. */
export async function expirePending(db: Db, now: Date, log: Pick<FastifyBaseLogger, "warn">, manifests: Manifests = APPS): Promise<number> {
  const due = await db.approvalRequest.findMany({ where: { status: "pending", expiresAt: { lte: now } }, orderBy: { expiresAt: "asc" }, take: 200 });
  let n = 0;
  for (const r of due) {
    const took = await db.$transaction(async (tx) => {
      const u = await tx.approvalRequest.updateMany({ where: { id: r.id, status: "pending", expiresAt: { lte: now } }, data: { status: "expired", decidedAt: now } });
      if (u.count !== 1) return false;
      await tx.auditLog.create({ data: { tenantId: r.tenantId, actorId: null, action: "approval.expired", target: labelOf(manifests, r.action), meta: { approvalId: r.id } } });
      return true;
    });
    if (!took) continue;
    n++;
    await notify(db, [r.makerId], { type: "approval", title: `Expired: ${labelOf(manifests, r.action)}`, message: "Nobody decided it in time. Ask again if you still need it.", link: APPROVALS_LINK, tenantId: r.tenantId })
      .catch((err: unknown) => log.warn({ err }, "approval expiry notification failed"));
  }
  return n;
}
