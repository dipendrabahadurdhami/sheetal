// Tests for a business's listings on the kernel (P2-W5): what the move to apps/listings/backend added. listings.test.ts (the old tests) is NOT repeated
// here and passes unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: covers the kernel columns, the events written with each change, a stale edit (409), and isolation (another business can't see or change a listing).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

const media = mkdtempSync(join(tmpdir(), "sheetal-media-k-"));
// The smallest real PNG (1×1 pixel): uploads are opened and saved as WebP sizes.
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex").toString("base64");
let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PATCH", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.agency! } });
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { tenantId: ids.agency, name } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, leads, notifications, audit_logs, event_outbox RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-listings.test`, userName: `kl-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("Listings on the kernel", () => {
  it("saves a draft with the kernel columns and an event, and refuses an edit made on an old version", async () => {
    const photo = (await call("owner", "POST", "/listing-photos", { data: PNG })).json().data.file as string;
    const summary = { title: "3 BHK house for sale in Dhapasi", category: "House", district: "Kathmandu", area: "Dhapasi", price: 25000000, bedrooms: 3, photos: [photo] };
    const r = await call("owner", "POST", "/listings", { kind: "sell", values: { category: "house" }, summary, submit: false });
    expect(r.statusCode).toBe(200);
    const code = r.json().data.id as string;
    expect(r.json().data.version).toBe(1);
    expect(await app.db!.listing.findFirstOrThrow({ where: { code } })).toMatchObject({ createdBy: ids.owner, updatedBy: ids.owner, status: "draft" });
    expect(await events("listings.listing.drafted")).toHaveLength(1);
    expect((await call("owner", "PATCH", `/listings/${code}`, { kind: "sell", summary: { ...summary, title: "3 BHK house in Dhapasi, Kathmandu" }, submit: false, version: 1 })).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/listings/${code}`, { kind: "sell", summary, submit: false, version: 1 })).statusCode).toBe(409);
    expect(await events("listings.listing.updated")).toHaveLength(1);
    ids.code = code;
  });

  it("never shows or changes another business's listing, and deleting keeps it as removed with an event", async () => {
    expect((await call("other", "GET", `/listings/${ids.code}`, undefined, ids.otherBiz)).statusCode).toBe(404);
    expect((await call("other", "POST", "/listings/delete", { ids: [ids.code] }, ids.otherBiz)).statusCode).toBe(404);
    expect((await call("owner", "POST", "/listings/delete", { ids: [ids.code] })).statusCode).toBe(200);
    expect((await app.db!.listing.findFirstOrThrow({ where: { code: ids.code } })).status).toBe("removed");
    expect(await events("listings.listing.removed")).toHaveLength(1);
    expect(await app.db!.auditLog.count({ where: { tenantId: ids.agency, action: "listing.removed" } })).toBe(1);
  });
});
