// Tests for hotels on the kernel (P2-W4): what the move to apps/hotel/backend added. operations.test.ts (the old hotel tests) is NOT repeated here and passes
// unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: covers two bookings of the last room at the same moment (exactly one wins), the kernel columns and events, a stale room change (409), and
// isolation (another business can't see or change these bookings).
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
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { tenantId: ids.hotel, name } });
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, rooms, bookings, audit_logs, event_outbox RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-hotel.test`, userName: `kh-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Inn", type: "hotel", planId: "hotel-business" }))).id;
  ids.otherHotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Inn", type: "hotel", planId: "hotel-business" }))).id;
});
afterAll(async () => { await app.close(); });

describe("Hotel on the kernel", () => {
  it("adds rooms with the kernel columns and an event, and refuses a stale room change", async () => {
    expect((await call("owner", "POST", "/rooms", { type: "Suite", rate: 9000, nos: ["501"] }, ids.hotel!)).statusCode).toBe(200);
    const room = (await call("owner", "GET", "/rooms", undefined, ids.hotel!)).json().data[0];
    expect(room.version).toBe(1);
    expect(await app.db!.room.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ createdBy: ids.owner, deletedAt: null });
    expect(await events("hotel.room.added")).toHaveLength(1);
    expect((await call("owner", "PATCH", `/rooms/${room.id}`, { rate: 9500, version: 1 }, ids.hotel!)).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/rooms/${room.id}`, { rate: 9900, version: 1 }, ids.hotel!)).statusCode).toBe(409);
  });

  it("gives the last room to exactly one of two bookings made at the same moment", async () => {
    const ask = (guest: string) => call("owner", "POST", "/bookings", { type: "Suite", guest, from: day(3), to: day(5) }, ids.hotel!);
    const [a, b] = await Promise.all([ask("Sita Sharma"), ask("Ram Thapa")]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await app.db!.booking.count({ where: { tenantId: ids.hotel, roomType: "Suite", status: { not: "cancelled" } } })).toBe(1);
    expect(await events("hotel.booking.created")).toHaveLength(1);
    ids.booking = (a.statusCode === 200 ? a : b).json().data.id;
  });

  it("never shows or changes another business's bookings", async () => {
    expect((await call("other", "PATCH", `/bookings/${ids.booking}`, { status: "cancelled" }, ids.otherHotel!)).statusCode).toBe(404);
    expect((await call("other", "GET", "/bookings", undefined, ids.otherHotel!)).json().data).toEqual([]);
    expect((await call("owner", "PATCH", `/bookings/${ids.booking}`, { status: "cancelled" }, ids.hotel!)).statusCode).toBe(200);
    expect(await events("hotel.booking.cancelled")).toHaveLength(1);
  });
});
