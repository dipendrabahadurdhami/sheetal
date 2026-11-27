import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { buildApp } from "../src/app.js";

// Investing online (owner's rule, 27 Nov 2026): a business's "Raise funds online" switch decides whether its investment pages take
// pledges (amount and contact, saved as a commitment and a lead) or only enquiries; partners are the businesses on a paid plan.
let app: FastifyInstance;
const ids: Record<string, string> = {};
let listingId = 0;
let n = 0;
const post = (url: string, payload: object) => app.inject({ method: "POST", url: `/v1${url}`, payload, remoteAddress: `10.7.0.${++n}` });
const pledge = { name: "Hari Bastola", phone: "9800000011", email: "hari@invest.test", amount: 500000 };

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "website"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, listings, leads, commitments RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const owner = await db.user.create({ data: { email: "owner@hub.test", userName: "owner", emailVerifiedAt: new Date() } });
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: "Hub Developers", type: "developer", planId: "developer-business" }))).id;
  await db.tenant.update({ where: { id: ids.biz }, data: { status: "active", email: "office@hub.test" } });
  ids.free = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: "Free Homes", type: "agency" }))).id;
  await db.tenant.update({ where: { id: ids.free }, data: { status: "active" } });
  const branch = await db.branch.findFirstOrThrow({ where: { tenantId: ids.biz } });
  listingId = (await db.listing.create({ data: { code: "HD-0001", slug: "hub-invest", tenantId: ids.biz, branchId: branch.id, kind: "invest", purpose: "sale", category: "Investment", title: "Villa hub", status: "published", publishedAt: new Date() } })).id;
});
afterAll(async () => { await app.close(); });

describe("raise funds online", () => {
  it("off: the page says so and a pledge is refused (enquiries only)", async () => {
    const page = (await app.inject({ method: "GET", url: "/v1/property-by-slug/hub-invest" })).json().data;
    expect(page.raise_funds).toBe(false);
    const r = await post(`/invest/${listingId}`, pledge);
    expect(r.statusCode).toBe(400);
    expect(await app.db!.commitment.count()).toBe(0);
  });

  it("on: a pledge is saved as a commitment and a lead, and the business is told", async () => {
    const db = app.db!;
    await db.tenant.update({ where: { id: ids.biz }, data: { settings: { payments: { raiseFunds: true } } } });
    expect((await app.inject({ method: "GET", url: "/v1/property-by-slug/hub-invest" })).json().data.raise_funds).toBe(true);
    expect((await post(`/invest/${listingId}`, { ...pledge, amount: 50 })).statusCode).toBe(422);
    const r = await post(`/invest/${listingId}`, pledge);
    expect(r.statusCode).toBe(200);
    expect(r.json().message).toMatch(/Rs\. 5,00,000/);
    const c = await db.commitment.findFirstOrThrow({ where: { listingId } });
    expect(c).toMatchObject({ tenantId: ids.biz, name: "Hari Bastola", status: "pledged", amount: 500000n });
    expect(await db.lead.count({ where: { tenantId: ids.biz, kind: "invest" } })).toBe(1);
    expect(await db.outboundEmail.count({ where: { to: "office@hub.test", subject: { startsWith: "Investment pledge" } } })).toBe(1);
  });
});

describe("partners", () => {
  it("lists businesses on a paid plan only, with their type", async () => {
    const list = (await app.inject({ method: "GET", url: "/v1/agent-list" })).json().data as { id: string; business_type: string }[];
    expect(list.map((x) => x.id)).toEqual([ids.biz]);
    expect(list[0]!.business_type).toBe("developer");
  });
});
