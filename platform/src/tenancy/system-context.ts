// The context an event handler runs with (KERNEL.md section 9, rule 5): a BusinessContext of ONE business whose actor is the handler.
// Where it fits: the dispatcher (platform/src/jobs/dispatcher.ts) calls it once per handler call through SystemContextFactory;
// each API wires it with its own effectiveLimits, the same way buildBusinessContext gets it (TenancyDeps).
// How it works: loads the business and its plan, its branches and its seats, and builds the usual pieces with the same builders a request
// uses (branch scope for every branch, entitlements from today's plan). Permissions are "*" and the branch scope is "all", but only
// inside this one business: every repository still adds tenantId from the context, so a handler can never read or write another business.
// Rules: actor = { kind: "system", job: <handler id> }, so createdBy / updatedBy are null (actorIdOf); `member` is a stand-in with the
// id "system" and must never be written to a table; no impersonation. A business that does not exist is an error (the event is
// retried and ends as a dead letter), never an empty context.

import type { FastifyBaseLogger } from "fastify";
import type { SystemContext, Tx } from "../core/context.js";
import type { Db } from "../db/client.js";
import { buildEntitlements, buildPermissionSet, countSeats, createBranchScope, loadBranches, type TenancyDeps } from "./context.js";

export interface SystemContextInput {
  db: Db;
  log: FastifyBaseLogger;
  tenantId: string;
  /** The handler id, e.g. "invoicing.on-expense-confirmed". */
  handlerId: string;
  requestId: string;
  now?: Date;
}

type Parts = Omit<SystemContext, "tx" | "transaction">;

function assemble(parts: Parts, tx: Tx | null): SystemContext {
  return {
    ...parts, tx,
    transaction: (async (fn: (c: SystemContext) => Promise<unknown>) =>
      tx ? fn(assemble(parts, tx)) : parts.db.$transaction(async (t) => fn(assemble(parts, t)))) as SystemContext["transaction"],
  };
}

export async function buildSystemContext(r: SystemContextInput, deps: TenancyDeps): Promise<SystemContext> {
  const now = r.now ?? new Date();
  const t = await r.db.tenant.findUnique({ where: { id: r.tenantId }, include: { plan: true } });
  if (!t) throw new Error(`Business ${r.tenantId} does not exist, so the event cannot be handled.`);
  const [all, plan, seatsUsed] = await Promise.all([
    loadBranches(r.db, t.id),
    deps.effectiveLimits(r.db, t.id, t.plan),
    countSeats(r.db, t.id, now),
  ]);
  return assemble({
    requestId: r.requestId, ip: "system", now, db: r.db, log: r.log,
    actor: { kind: "system", job: r.handlerId },
    business: { id: t.id, name: t.name, type: t.type, status: t.status, planId: t.planId },
    member: { userId: "system", membershipId: "system", roleId: "system", roleKey: "system", isOwner: true },
    branches: createBranchScope({ all, allowed: "all", wanted: undefined }),
    permissions: buildPermissionSet(["*"]),
    entitlements: buildEntitlements({ type: t.type, plan: t.plan, limits: plan.limits, seatsUsed }),
    impersonation: null,
  }, null);
}
