// Tests for the business Overview on the kernel (P2-W6, Workspace part 2): what the move to apps/workspace/backend added. overview.test.ts (the old
// test: who sees which block, branches, money) is NOT repeated here and passes unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: the Overview is read only (no audit line, no event); another business's records are never counted; a limited member counts only their
// branch even with "all" picked; a read-only support session can open it. There is nothing to write, so no version, conflict or soft delete here.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { makeTestContext } from "@sheetal/platform/core/testing/context";
import { buildImpersonationPermissions } from "@sheetal/platform/tenancy/context";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { OverviewService } from "@sheetal/app-workspace/backend/overview.service";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, tenant = ids.biz!, branch?: string) =>
  app.inject({ method: "GET", url: "/v1/overview", headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant, ...(branch ? { "x-branch": branch } : {}) } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox, listings, leads RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other", "lim"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-ov.test`, userName: `ko-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.biz } })).id;
  ids.pk = (await db.branch.create({ data: { tenantId: ids.biz!, name: "Pokhara" } })).id;
  ids.otherHead = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.otherBiz } })).id;
  const listing = (n: number, tenantId: string, branchId: string) =>
    db.listing.create({ data: { code: `KO-${n}`, slug: `ko-${n}`, tenantId, branchId, purpose: "sale", category: "House", title: `House ${n}`, status: "published" } });
  await listing(1, ids.biz!, ids.head!); await listing(2, ids.biz!, ids.pk!);
  for (let n = 3; n < 8; n++) await listing(n, ids.otherBiz!, ids.otherHead!);
  // A branch manager limited to Pokhara (by branch id).
  const bm = await db.role.findFirstOrThrow({ where: { tenantId: ids.biz, key: "branch_manager" } });
  const m = await db.membership.create({ data: { tenantId: ids.biz!, userId: ids.lim!, roleId: bm.id, status: "active", allBranches: false, scopes: ["Pokhara"] } });
  await db.membershipBranch.create({ data: { membershipId: m.id, branchId: ids.pk! } });
});
afterAll(async () => { await app.close(); });

describe("the Overview on the kernel", () => {
  it("is read only: no audit line and no event", async () => {
    const before = [await app.db!.auditLog.count(), await app.db!.eventOutbox.count()];
    expect((await call("owner")).statusCode).toBe(200);
    expect([await app.db!.auditLog.count(), await app.db!.eventOutbox.count()]).toEqual(before);
  });

  it("never counts another business's records, and needs a member of the business", async () => {
    expect((await call("owner")).json().data.listings.published).toBe(2);
    expect((await call("other", ids.otherBiz)).json().data.listings.published).toBe(5);
    expect((await call("owner", ids.otherBiz)).statusCode).toBe(403);
  });

  it("a member limited to one branch counts only that branch, even with all branches or another branch picked", async () => {
    expect((await call("lim")).json().data).toMatchObject({ branches: 1, listings: { published: 1 } });
    expect((await call("lim", ids.biz, "all")).json().data.listings.published).toBe(1);
    expect((await call("owner", ids.biz, ids.pk)).json().data.listings.published).toBe(1);
  });

  it("opens for a read-only support session", async () => {
    const ctx = {
      ...makeTestContext({ db: app.db!, businessId: ids.biz!, branches: [{ id: ids.head! }, { id: ids.pk! }], userId: "support-1", isOwner: false }),
      actor: { kind: "staff" as const, staffId: "support-1", name: "Support", role: "support" },
      member: { userId: "support-1", membershipId: "", roleId: "", roleKey: "support", isOwner: false },
      permissions: buildImpersonationPermissions(),
      impersonation: { staffId: "support-1", reason: "customer asked for help", expiresAt: new Date(Date.now() + 15 * 60_000), readOnly: true },
    };
    await expect(new OverviewService().overview(ctx)).resolves.toMatchObject({ listings: { published: 2 }, branches: 2 });
  });
});
