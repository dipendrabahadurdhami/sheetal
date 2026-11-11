// Pure rules of the approvals gate (ACCESS.md section 9.4) and the 202 answer. No database: the gate is a fake, the repository records calls.
// Run with: npm run test -w @sheetal/platform
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApprovalRequested, type ApprovalGate } from "../src/core/approval.js";
import { AppError, errorHandler } from "../src/core/errors.js";
import { OutboxEventBus } from "../src/core/events.js";
import { BaseService } from "../src/core/service.js";
import { makeTestContext } from "../src/core/testing/context.js";
import type { BusinessContext } from "../src/core/context.js";
import { deciderProblem, effectiveRule, needsApproval } from "../src/approvals/service.js";

const decl = { action: "expenses.expense.confirm", approverPermission: "expenses.expense.approve", enabledByDefault: false } as never;
const rowOn = { enabled: true, thresholdPaisa: 500_000n, approverPermission: "expenses.expense.approve", expiresHours: 24 };

describe("effectiveRule / needsApproval", () => {
  it("no manifest entry and no row = not approvable", () => {
    expect(effectiveRule(null, null, "x.y.z")).toBeNull();
    expect(needsApproval(null, 10)).toBe(false);
  });
  it("rules are OFF without a row (Phase 1 default)", () => {
    const r = effectiveRule(decl, null, "expenses.expense.confirm");
    expect(r?.enabled).toBe(false);
    expect(needsApproval(r, 99_999_999)).toBe(false);
  });
  it("a row with a limit holds an amount at or over it, runs a smaller one, and holds an unknown amount", () => {
    const r = effectiveRule(decl, rowOn, "expenses.expense.confirm");
    expect(needsApproval(r, 499_999)).toBe(false);
    expect(needsApproval(r, 500_000)).toBe(true);
    expect(needsApproval(r, undefined)).toBe(true);
  });
  it("a required manifest rule cannot be switched off by a row", () => {
    const req = { ...(decl as object), enabledByDefault: true } as never;
    const r = effectiveRule(req, { ...rowOn, enabled: false, thresholdPaisa: null }, "expenses.expense.confirm");
    expect(r?.required).toBe(true);
    expect(needsApproval(r, 1)).toBe(true);
  });
});

describe("deciderProblem", () => {
  const ok = { makerId: "a", deciderId: "b", holdsApproverPermission: true, impersonating: false };
  it("lets another person with the permission decide", () => expect(deciderProblem(ok)).toBeNull());
  it("refuses the maker, a missing permission, and a support session (in that message order)", () => {
    expect(deciderProblem({ ...ok, deciderId: "a" })?.statusCode).toBe(403);
    expect(deciderProblem({ ...ok, holdsApproverPermission: false })?.statusCode).toBe(403);
    expect(deciderProblem({ ...ok, impersonating: true })?.message).toMatch(/support session/);
  });
});

describe("ApprovalRequested", () => {
  it("is a 202 { message, code, data } answer", async () => {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    app.get("/x", async () => { throw new ApprovalRequested("ap1"); });
    const res = await app.inject({ method: "GET", url: "/x" });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ code: "approval_requested", data: { approvalId: "ap1" } });
  });
});

// ── BaseService.action() with a fake gate ──
const ran: string[] = [];
const fakeDb = { $transaction: async (fn: (t: unknown) => unknown) => fn({}) } as never;
const repo = new Proxy({ branched: false }, { get: (t, p: string) => (p in t ? (t as Record<string, unknown>)[p] : async () => ({})) });
class S extends BaseService<never, { n: string }, { n: string }> {
  go(ctx: BusinessContext) {
    return this.action(ctx, {
      name: "confirm", permission: "notes.note.update", approval: { action: "expenses.expense.confirm" },
      audit: () => ({ action: "note.confirm", target: "r1" }), run: async () => { ran.push("run"); return { branchId: null }; },
    } as never);
  }
}
const mk = (approvals?: ApprovalGate) => new S({
  app: "notes", resource: "note", repo: repo as never,
  permissions: { read: "notes.note.read", create: "notes.note.create", update: "notes.note.update", delete: "notes.note.delete" },
  schemas: { create: z.object({ n: z.string() }), update: z.object({ n: z.string() }) },
  audit: { entity: "note", label: () => "n" }, bus: new OutboxEventBus(), requireVersion: false, approvals,
} as never);
const ctx = makeTestContext({ db: fakeDb, businessId: "biz", branches: [{ id: "b1" }] });

describe("BaseService.action() and the approvals gate", () => {
  it("a held action is not run and answers ApprovalRequested", async () => {
    ran.length = 0;
    const e = await mk({ intercept: async () => ({ approvalId: "ap9" }) }).go(ctx).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(ApprovalRequested);
    expect((e as AppError).statusCode).toBe(202);
    expect(ran).toEqual([]);
  });
  it("a rule that is off (gate returns null) runs the action straight away", async () => {
    ran.length = 0;
    await mk({ intercept: async () => null }).go(ctx).catch(() => undefined);
    expect(ran).toEqual(["run"]);
  });
  it("the executor path (ctx.approval set) skips the gate", async () => {
    ran.length = 0;
    let asked = 0;
    await mk({ intercept: async () => { asked++; return { approvalId: "x" }; } }).go({ ...ctx, approval: { id: "ap1", makerId: "u" } } as never).catch(() => undefined);
    expect(asked).toBe(0);
    expect(ran).toEqual(["run"]);
  });
  it("an action that asks for approval on a service with no gate refuses to run unchecked", async () => {
    ran.length = 0;
    await expect(mk(undefined).go(ctx)).rejects.toThrow(/no approval gate/);
    expect(ran).toEqual([]);
  });
});
