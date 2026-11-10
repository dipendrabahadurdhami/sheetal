// A read-only staff support session can read but never write through BaseService (platform/src/core/service.ts).
// No database needed: the refusal happens before any transaction starts, and the fake repository records every call.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "../src/core/errors.js";
import { BaseService } from "../src/core/service.js";
import { OutboxEventBus } from "../src/core/events.js";
import { makeTestContext } from "../src/core/testing/context.js";
import type { BusinessContext } from "../src/core/context.js";

type Row = { id: string; note: string };
const calls: string[] = [];
const row = { id: "r1", note: "x", tenantId: "biz", branchId: null, version: 1, createdAt: new Date(), updatedAt: new Date(), createdBy: null, updatedBy: null, deletedAt: null, deletedBy: null };
const fakeRepo = new Proxy({ branched: false }, {
  get(target, prop: string) {
    if (prop in target) return (target as Record<string, unknown>)[prop];
    return async () => { calls.push(prop); return row; };
  },
});

class NoteService extends BaseService<never, { note: string }, { note: string }> {
  doAction(ctx: BusinessContext) {
    return this.action(ctx, { name: "confirm", permission: "notes.note.update", id: "r1", run: async () => row } as never);
  }
}
const service = new NoteService({
  app: "notes", resource: "note", repo: fakeRepo as never,
  permissions: { read: "notes.note.read", create: "notes.note.create", update: "notes.note.update", delete: "notes.note.delete" },
  schemas: { create: z.object({ note: z.string() }), update: z.object({ note: z.string() }) },
  audit: { entity: "note", label: (r: Row) => r.note },
  bus: new OutboxEventBus(),
  requireVersion: false,
});

const normal = makeTestContext({ db: {} as never, businessId: "biz", branches: [{ id: "b1" }] });
const readOnly: BusinessContext = { ...normal, actor: { kind: "staff", staffId: "s1", name: "Support", role: "support" }, impersonation: { staffId: "s1", reason: "customer asked for help", expiresAt: new Date(Date.now() + 3600_000), readOnly: true } };

async function refused(p: Promise<unknown>) {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).statusCode).toBe(403);
}

describe("read-only support session", () => {
  it("can still read", async () => {
    calls.length = 0;
    await expect(service.get(readOnly, "r1")).resolves.toBeTruthy();
    expect(calls).toContain("get");
  });

  it("is refused on create, update, remove, restore and actions, and nothing reaches the repository", async () => {
    calls.length = 0;
    await refused(service.create(readOnly, { note: "new" }));
    await refused(service.update(readOnly, "r1", { note: "changed" }));
    await refused(service.remove(readOnly, "r1", 1));
    await refused(service.restore(readOnly, "r1"));
    await refused(service.doAction(readOnly));
    expect(calls).toEqual([]);
  });
});
