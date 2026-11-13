// A calendar feed's booking writes take the same room-type hold as a booking made in the panel (P2-W6 leftover): while another transaction holds
// the rooms of that type at that branch (RoomRepository.lockType / holdRoomType), the feed sync waits, and its booking appears only after that
// transaction ends. ota.test.ts (the old feed tests) passes unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { holdRoomType, syncOtaFeed } from "@sheetal/backend-core/domain/ota";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const ids: Record<string, string> = {};
const ICS = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:hold-1", "SUMMARY:Feed guest", "DTSTART;VALUE=DATE:20991201", "DTEND;VALUE=DATE:20991203", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const feedFetch = (async () => new Response(ICS, { status: 200 })) as never;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test"}, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, ota_feeds RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const u = await db.user.create({ data: { email: "owner@ota-hold.test", userName: "ota-hold", emailVerifiedAt: new Date() } });
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: u.id, name: "Hold Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.branch = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.biz } })).id;
  await db.room.create({ data: { tenantId: ids.biz!, branchId: ids.branch, no: "101", type: "Deluxe", rate: 5000 } });
  ids.feed = (await db.otaFeed.create({ data: { tenantId: ids.biz!, roomType: "Deluxe", site: "booking", url: "https://example.test/cal.ics" } })).id;
});
afterAll(async () => { await app.close(); });

describe("a feed sync and the room-type hold", () => {
  it("waits while the rooms of that type are held, then books", async () => {
    const db = app.db!;
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    let held!: () => void;
    const holding = new Promise<void>((r) => { held = r; });
    // A panel booking at the same moment: it holds the Deluxe rooms of the branch until `release`.
    const panel = db.$transaction(async (tx) => { await holdRoomType(tx, ids.biz!, ids.branch!, "Deluxe"); held(); await released; }, { timeout: 15_000 });
    await holding;
    const sync = syncOtaFeed(db, ids.feed!, feedFetch);
    await new Promise((r) => setTimeout(r, 400));
    expect(await db.booking.count({ where: { tenantId: ids.biz, externalUid: "booking:hold-1" } })).toBe(0);   // still waiting for the hold
    release();
    await panel;
    expect(await sync).toMatchObject({ added: 1 });
    expect(await db.booking.findFirstOrThrow({ where: { tenantId: ids.biz, externalUid: "booking:hold-1" } })).toMatchObject({ roomType: "Deluxe", branchId: ids.branch, status: "confirmed" });
  });

  it("a second sync of the same feed changes nothing", async () => {
    expect(await syncOtaFeed(app.db!, ids.feed!, feedFetch)).toMatchObject({ added: 0, updated: 0, cancelled: 0 });
  });
});
