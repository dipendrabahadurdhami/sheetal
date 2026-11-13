// Tests for Projects and Investments on the kernel (P2-W3): what the move added. operations.test.ts (the old tests) is NOT repeated here and passes unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: covers the kernel columns, the events written with each change (same transaction), "fully paid = sold" in one step, version conflict (409) on a unit,
// a pledge marked twice, and isolation (another business can't see or change units, reservations or pledges).
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PATCH", url: string, body: object | undefined, tenant: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant } });
const events = (tenantId: string, name: string) => app.db!.eventOutbox.findMany({ where: { tenantId, name } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, units, reservations, collections, commitments, investment_updates, outbound_emails, audit_logs, event_outbox RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["dev", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-proj.test`, userName: `kp-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.devco = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.dev!, name: "Heights Builders", type: "developer", planId: "developer-business" }))).id;
  ids.sponsor = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.dev!, name: "Heights Invest", type: "sponsor", planId: "sponsor-business" }))).id;
  ids.otherco = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Builders", type: "developer", planId: "developer-business" }))).id;
  ids.project = String((await db.listing.create({ data: { code: "KP-0001", slug: "kp-heights", tenantId: ids.devco, kind: "project", purpose: "sale", category: "Project", title: "Heights Residency", status: "published" } })).id);
  ids.invest = String((await db.listing.create({ data: { code: "KP-0002", slug: "kp-lodge", tenantId: ids.sponsor, kind: "invest", purpose: "sale", category: "Investment", title: "Chitwan Lodge", status: "published", price: 50_000_000n } })).id);
});
afterAll(async () => { await app.close(); });

describe("Projects on the kernel", () => {
  it("adds units with the kernel columns and an event, and refuses a unit change made on an old version", async () => {
    expect((await call("dev", "POST", `/projects/${ids.project}/units`, { block: "A", type: "2BHK", price: 10_000_000, nos: ["101"] }, ids.devco!)).statusCode).toBe(200);
    const unit = (await call("dev", "GET", "/projects", undefined, ids.devco!)).json().data[0].units[0];
    expect(unit.version).toBe(1);
    expect(await app.db!.unit.findUniqueOrThrow({ where: { id: unit.id } })).toMatchObject({ createdBy: ids.dev, deletedAt: null });
    expect(await events(ids.devco!, "projects.unit.added")).toHaveLength(1);
    expect((await call("dev", "PATCH", `/units/${unit.id}`, { price: 11_000_000, version: 1 }, ids.devco!)).statusCode).toBe(200);
    expect((await call("dev", "PATCH", `/units/${unit.id}`, { price: 12_000_000, version: 1 }, ids.devco!)).statusCode).toBe(409);
    ids.unit = unit.id;
  });

  it("marks the reservation and the unit sold in the same step as the last payment, with events", async () => {
    const r = (await call("dev", "POST", `/units/${ids.unit}/reserve`, { buyer: "Bikash" }, ids.devco!)).json().data;
    expect(r.price).toBe(11_000_000);
    expect((await call("dev", "POST", `/reservations/${r.id}/collections`, { amount: 1_000_000, method: "bank" }, ids.devco!)).statusCode).toBe(200);
    const done = await call("dev", "POST", `/reservations/${r.id}/collections`, { amount: 10_000_000, method: "bank" }, ids.devco!);
    expect(done.json().message).toBe("Fully paid. The unit is sold.");
    expect((await app.db!.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("sold");
    expect((await app.db!.unit.findUniqueOrThrow({ where: { id: ids.unit! } })).status).toBe("sold");
    expect(await events(ids.devco!, "projects.reservation.paid")).toHaveLength(1);
    expect(await events(ids.devco!, "projects.reservation.sold")).toHaveLength(1);
    expect(await app.db!.collection.count({ where: { reservationId: r.id, createdBy: ids.dev } })).toBe(2);
    ids.res = r.id;
  });

  it("never shows or changes another business's units or reservations", async () => {
    expect((await call("other", "PATCH", `/units/${ids.unit}`, { price: 1 }, ids.otherco!)).statusCode).toBe(404);
    expect((await call("other", "POST", `/reservations/${ids.res}/collections`, { amount: -1, method: "bank" }, ids.otherco!)).statusCode).toBe(404);
    expect((await call("other", "GET", "/reservations", undefined, ids.otherco!)).json().data).toEqual([]);
  });
});

describe("Investments on the kernel", () => {
  it("writes a pledge with an event, marks it paid once, and keeps other businesses out", async () => {
    expect((await call("dev", "POST", `/investments/${ids.invest}/commitments`, { name: "Anita", amount: 1_000_000 }, ids.sponsor!)).statusCode).toBe(200);
    const inv = (await call("dev", "GET", "/investments", undefined, ids.sponsor!)).json().data[0];
    const c = inv.investors[0];
    expect(c.version).toBe(1);
    expect(await events(ids.sponsor!, "investments.commitment.pledged")).toHaveLength(1);
    expect((await call("other", "PATCH", `/commitments/${c.id}`, { status: "paid" }, ids.otherco!)).statusCode).toBe(404);
    expect((await call("dev", "PATCH", `/commitments/${c.id}`, { status: "paid", ref: "B-1" }, ids.sponsor!)).statusCode).toBe(200);
    expect((await call("dev", "PATCH", `/commitments/${c.id}`, { status: "paid" }, ids.sponsor!)).statusCode).toBe(400);
    expect(await events(ids.sponsor!, "investments.commitment.paid")).toHaveLength(1);
  });
});
