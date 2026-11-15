// Maker-checker for Sheetal staff (MARKETPLACE-AND-BILLING.md sections 3.2 and 11; ACCESS.md section 9): a second staff member approves a
// price rise that paying businesses have, and every refund.
// Where it fits: pricing.ts and refunds.ts create requests with requestApproval() and register what approving does (an Executor);
// adminApprovalRoutes() lists the requests and takes the decision. Registered in admin/backend/src/app.ts under /v1.
//   GET  /admin/approvals                 ?status=pending|done|all   the requests this staff member may see (by the action's permission)
//   POST /admin/approvals/:id/decide      { decision: "approve" | "reject", note }
// How it works: a request is a PlatformApproval row (action, payload, amount, maker, 72 hours to decide). Approving claims the row with one
// conditional update (pending and not expired -> approved), so two approvers at once can't both run it, then the action's executor runs;
// the executor writes `executedAt` and `result` (status executed), or the request is marked failed with the reason (nothing changed). When nobody else on the team holds the approver permission, the maker's request runs at
// once and the audit row says the second check was skipped (the one-person team rule, ACCESS.md section 9).
// Rules: the maker can never approve their own request, super admin included. Expired requests are never run. Every step is audited.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma, PlatformApproval } from "@prisma/client";
import { z } from "zod";
import { dbOf, type Db } from "@sheetal/platform/db/client";
import { AppError, badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import { PLATFORM_ROLES, hasPerm } from "@sheetal/backend-core/domain/permissions";
import { notify } from "@sheetal/platform/notify/index";
import { staffOf, type Staff } from "./routes.js";

type Tx = Prisma.TransactionClient;
export const APPROVAL_HOURS = 72;

/** What one approvable action is: who may check it, its words, and what approving does. */
export interface Executor {
  action: string;
  /** The staff permission a checker needs (and that the list is filtered by). */
  permission: string;
  label: string;
  /** Runs the approved request. It must claim the row first (claimApproval) inside its own transaction where it can. */
  run: (row: PlatformApproval, checker: Staff, request: FastifyRequest, note: string) => Promise<object>;
}

// Per API instance (keyed by its database client, shared by every plugin of one app): tests build several apps in one process.
const registry = new WeakMap<object, Map<string, Executor>>();
const executorsOf = (db: Db) => { let m = registry.get(db); if (!m) { m = new Map(); registry.set(db, m); } return m; };
export const registerExecutor = (db: Db, e: Executor) => { executorsOf(db).set(e.action, e); };

/** Staff (other than `except`) whose role holds `perm`: the people who could approve. */
export async function approversFor(db: Db, perm: string, except?: string): Promise<{ id: string }[]> {
  const roles = Object.keys(PLATFORM_ROLES).filter((r) => hasPerm(PLATFORM_ROLES[r]!, perm));
  return db.user.findMany({ where: { platformRole: { in: roles }, status: "active", ...(except ? { id: { not: except } } : {}) }, select: { id: true } });
}

/** Stores a request and tells the people who can approve it. */
export async function requestApproval(db: Db, o: { action: string; resource: string; resourceId?: string | null; payload: object; amountPaisa?: number | null; maker: Staff; note: string; now: Date; ip: string; target: string; tenantId?: string | null }) {
  const e = executorsOf(db).get(o.action);
  if (!e) throw new Error(`No executor for ${o.action}`);
  const row = await db.$transaction(async (tx) => {
    const r = await tx.platformApproval.create({ data: {
      action: o.action, resource: o.resource, resourceId: o.resourceId ?? null, payload: o.payload as Prisma.InputJsonValue,
      amountPaisa: o.amountPaisa == null ? null : BigInt(o.amountPaisa), status: "pending", makerId: o.maker.user.id, makerNote: o.note.slice(0, 300),
      expiresAt: new Date(o.now.getTime() + APPROVAL_HOURS * 3_600_000),
    } });
    await tx.auditLog.create({ data: { actorId: o.maker.user.id, tenantId: o.tenantId ?? null, action: "approval.requested", target: `${e.label}: ${o.target}`, ip: o.ip, meta: { approvalId: r.id, action: o.action, note: o.note } } });
    return r;
  });
  const people = await approversFor(db, e.permission, o.maker.user.id);
  await notify(db, people.map((p) => p.id), { tenantId: null, type: "approval", title: `Waiting for your approval: ${e.label}`, message: `${o.target}. Asked by ${o.maker.user.userName}: ${o.note}`.slice(0, 900), link: "/admin/approvals" });
  return row;
}

/** Claims a pending request for its checker (one conditional update). Throws when it was decided already or has expired. */
export async function claimApproval(tx: Tx | Db, id: string, o: { checkerId: string | null; note: string; now: Date }) {
  const u = await tx.platformApproval.updateMany({
    where: { id, status: "pending", expiresAt: { gt: o.now }, ...(o.checkerId ? { makerId: { not: o.checkerId } } : {}) },
    data: { status: "approved", checkerId: o.checkerId, checkerNote: o.note.slice(0, 300), decidedAt: o.now },
  });
  if (u.count !== 1) throw conflict("This request was already decided, has expired, or is your own.");
}

/** Marks a claimed request as run, with what it did. */
export const markExecuted = (tx: Tx | Db, id: string, now: Date, result: object) =>
  tx.platformApproval.update({ where: { id }, data: { status: "executed", executedAt: now, result: result as Prisma.InputJsonValue } });
/** Marks a claimed request that could not be run (nothing was changed), with the reason. */
export const markFailed = (db: Db, id: string, message: string) =>
  db.platformApproval.update({ where: { id }, data: { status: "failed", result: { error: message } } });

const json = (r: PlatformApproval, label?: string) => ({
  id: r.id, action: r.action, label: label ?? r.action, resource: r.resource, resourceId: r.resourceId, payload: r.payload,
  amountPaisa: r.amountPaisa == null ? null : Number(r.amountPaisa), status: r.status, makerId: r.makerId, makerNote: r.makerNote, checkerId: r.checkerId,
  checkerNote: r.checkerNote, createdAt: r.createdAt, decidedAt: r.decidedAt, expiresAt: r.expiresAt, executedAt: r.executedAt, result: r.result,
});
export const approvalJson = json;

const Decide = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().min(3, "Say why.").max(300) }).strict();

export async function adminApprovalRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const executors = () => executorsOf(db());

  app.get("/admin/approvals", async (request) => {
    const s = staffOf(request);
    const q = z.object({ status: z.enum(["pending", "done", "all"]).default("pending") }).parse(request.query);
    const mine = [...executors().values()].filter((e) => s.can(e.permission)).map((e) => e.action);
    if (!mine.length) throw forbidden("Your staff role can't see approvals.");
    const now = new Date();
    // Requests past their time are marked expired when anyone looks (they are never run).
    await db().platformApproval.updateMany({ where: { status: "pending", expiresAt: { lte: now } }, data: { status: "expired", decidedAt: now } });
    const where: Prisma.PlatformApprovalWhereInput = { action: { in: mine }, ...(q.status === "pending" ? { status: "pending" } : q.status === "done" ? { status: { not: "pending" } } : {}) };
    const rows = await db().platformApproval.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    const people = new Map((await db().user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.makerId, r.checkerId]).filter((x): x is string => !!x))] } }, select: { id: true, userName: true } })).map((u) => [u.id, u.userName]));
    return { data: rows.map((r) => ({ ...json(r, executors().get(r.action)?.label), maker: people.get(r.makerId) ?? null, checker: r.checkerId ? people.get(r.checkerId) ?? null : null, mayDecide: r.status === "pending" && r.makerId !== s.user.id })) };
  });

  app.post<{ Params: { id: string } }>("/admin/approvals/:id/decide", async (request) => {
    const s = staffOf(request);
    const b = Decide.parse(request.body);
    const row = await db().platformApproval.findUnique({ where: { id: request.params.id } });
    const e = row ? executors().get(row.action) : undefined;
    if (!row || !e || !s.can(e.permission)) throw notFound("Request not found.");
    if (row.makerId === s.user.id) throw forbidden("You asked for this yourself: another staff member must decide.");
    const now = new Date();
    if (row.status !== "pending") throw conflict("This request was already decided.");
    if (row.expiresAt <= now) {
      await db().platformApproval.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "expired", decidedAt: now } });
      throw conflict("This request has expired. Ask again if it is still needed.");
    }
    if (b.decision === "reject") {
      const u = await db().platformApproval.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "rejected", checkerId: s.user.id, checkerNote: b.note, decidedAt: now } });
      if (u.count !== 1) throw conflict("This request was already decided.");
      await db().auditLog.create({ data: { actorId: s.user.id, action: "approval.rejected", target: e.label, ip: request.ip, meta: { approvalId: row.id, note: b.note } } });
      await notify(db(), [row.makerId], { tenantId: null, type: "approval", title: `Not approved: ${e.label}`, message: b.note, link: "/admin/approvals" });
      return { message: "Rejected. The person who asked has been told." };
    }
    let result: object;
    try {
      result = await e.run(row, s, request, b.note);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw badRequest(err instanceof Error ? err.message : "This could not be done.");
    }
    await db().auditLog.create({ data: { actorId: s.user.id, action: "approval.approved", target: e.label, ip: request.ip, meta: { approvalId: row.id, note: b.note } } });
    await notify(db(), [row.makerId], { tenantId: null, type: "approval", title: `Approved: ${e.label}`, message: b.note, link: "/admin/approvals" });
    return { message: "Approved and done.", data: result };
  });
}
