// Tests for the growth tools on the kernel (P2-W6): what the split into Workspace (analytics, channels, AI meter), CRM (lead finder, Meta webhook) and
// Hotel (calendar feeds, iCal link, other-site requests) added. growth.test.ts and ota.test.ts (the old tests: lead finder, analytics, feeds, iCal, channels, webhook, requests) pass unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: connecting and disconnecting a channel write their audit line and event together (and nothing on a refusal); another business's channels and
// feeds are "not found"; a read-only support session reads but changes nothing. Channels are removed for real (no soft delete), as before.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { makeTestContext } from "@sheetal/platform/core/testing/context";
import { Vault } from "@sheetal/platform/auth/vault";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { GrowthService } from "@sheetal/app-workspace/backend/growth.service";
import { OtaService } from "@sheetal/app-hotel/backend/ota.service";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });
const count = (name: string) => app.db!.eventOutbox.count({ where: { tenantId: ids.biz, name } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox, channel_accounts, ota_feeds RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-growth.test`, userName: `kg-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.feed = (await db.otaFeed.create({ data: { tenantId: ids.biz!, roomType: "Deluxe", site: "booking", url: "https://example.test/cal.ics" } })).id;
});
afterAll(async () => { await app.close(); });

describe("growth tools on the kernel", () => {
  it("connecting and disconnecting a channel write their audit line and event together", async () => {
    const r = await call("owner", "POST", "/channels", { kind: "whatsapp", externalId: "1234567890", name: "Lakeside WhatsApp", accessToken: "x".repeat(30) });
    expect(r.json().message).toBe("Lakeside WhatsApp connected. New messages arrive in the Inbox.");
    expect([await app.db!.auditLog.count({ where: { tenantId: ids.biz, action: "channel.connected" } }), await count("workspace.channel.connected")]).toEqual([1, 1]);
    const listed = (await call("owner", "GET", "/channels")).json().data;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("accessToken");
    ids.channel = listed[0].id;
    const before = [await app.db!.auditLog.count(), await app.db!.eventOutbox.count()];
    expect((await call("owner", "POST", "/channels", { kind: "whatsapp", externalId: "1234567890", name: "Again", accessToken: "x".repeat(30) })).statusCode).toBe(400);
    expect((await call("other", "POST", `/channels/${ids.channel}/disconnect`, undefined, ids.otherBiz)).statusCode).toBe(404);
    expect([await app.db!.auditLog.count(), await app.db!.eventOutbox.count()]).toEqual(before);
    expect((await call("owner", "POST", `/channels/${ids.channel}/disconnect`)).json().message).toBe("Disconnected.");
    expect(await count("workspace.channel.disconnected")).toBe(1);
  });

  it("another business's calendar feeds are not found", async () => {
    expect((await call("other", "POST", `/ota/feeds/${ids.feed}/sync`, undefined, ids.otherBiz)).statusCode).toBe(404);
    expect((await call("other", "GET", "/ota/feeds", undefined, ids.otherBiz)).json().data.feeds).toEqual([]);
  });

  it("a read-only support session reads, and changes nothing", async () => {
    const REFUSED = { statusCode: 403, message: "This is a read-only support session. Changes are not allowed." };
    const ctx = {
      ...makeTestContext({ db: app.db!, businessId: ids.biz!, branches: [], userId: "support-1", isOwner: false }),
      actor: { kind: "staff" as const, staffId: "support-1", name: "Support", role: "support" },
      impersonation: { staffId: "support-1", reason: "customer asked for help", expiresAt: new Date(Date.now() + 15 * 60_000), readOnly: true },
    };
    const g = new GrowthService({ bus: app.events!.bus, db: app.db!, vault: new Vault("x".repeat(32), false) });
    const o = new OtaService({ bus: app.events!.bus, db: app.db!, secretsKey: "x".repeat(32), apiUrl: "https://api.sheetal.test", saveFile: async () => "f" });
    await expect(g.channels(ctx)).resolves.toEqual([]);
    await expect(o.feeds(ctx)).resolves.toMatchObject({ feeds: [expect.objectContaining({ id: ids.feed })] });
    const before = [await app.db!.auditLog.count(), await app.db!.eventOutbox.count(), await app.db!.otaFeed.count(), await app.db!.channelAccount.count()];
    for (const [what, run] of [
      ["connect", () => g.connect(ctx, { kind: "whatsapp", externalId: "99999999", name: "X", accessToken: "x".repeat(30) })], ["disconnect", () => g.disconnect(ctx, "x")],
      ["add feed", () => o.addFeed(ctx, { type: "Deluxe", site: "airbnb", url: "https://example.test/b.ics" })], ["sync", () => o.syncNow(ctx, ids.feed!)],
      ["ask", () => o.ask(ctx, { listingId: 1, channel: "booking", price: 10 })], ["answer", () => o.answer(ctx, "x", { text: "hi" })], ["stop", () => o.stop(ctx, "x")],
    ] as const) await expect(run(), what).rejects.toMatchObject(REFUSED);
    expect([await app.db!.auditLog.count(), await app.db!.eventOutbox.count(), await app.db!.otaFeed.count(), await app.db!.channelAccount.count()]).toEqual(before);
  });
});
