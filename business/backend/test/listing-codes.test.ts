import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { initialsOf } from "@sheetal/backend-core/domain/codes";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency! } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, listings RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent"]) {
    const u = await db.user.create({ data: { email: `${k}@himal.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Himal Homes Pvt Ltd", type: "agency", planId: "agency-business" }))).id;
  const role = await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "agent" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: role.id, status: "active" } });
  await db.listing.create({ data: { code: "SP-0001", slug: "house-1", tenantId: ids.agency, kind: "sell", purpose: "sale", category: "House", title: "House in Dhapasi", status: "published" } });
  await db.listing.create({ data: { code: "SP-0002", slug: "plot-2", purpose: "sale", category: "Land", title: "Plot posted by a person", status: "published" } });
});
afterAll(async () => { await app.close(); });

describe("property codes", () => {
  it("makes the default prefix from the business name", () => {
    expect(initialsOf("Himal Homes Pvt Ltd")).toBe("HH");
    expect(initialsOf("Everest Realty")).toBe("ER");
    expect(initialsOf("Lakeside")).toBe("LA");
    expect(initialsOf("शीतल")).toBe("SP");
  });

  it("shows the prefix, and only settings people change it", async () => {
    expect((await call("agent", "GET", "/listings/code-prefix")).json().data).toMatchObject({ prefix: "HH", custom: false, sample: "HH-0123", canChange: false });
    expect((await call("agent", "PUT", "/listings/code-prefix", { prefix: "HMH" })).statusCode).toBe(403);
    expect((await call("owner", "PUT", "/listings/code-prefix", { prefix: "1X" })).statusCode).toBe(422);
    expect((await call("owner", "PUT", "/listings/code-prefix", { prefix: "tmp" })).statusCode).toBe(400);
  });

  it("gives the business's listings the new code and keeps the old one", async () => {
    const r = await call("owner", "PUT", "/listings/code-prefix", { prefix: "hmh" });
    expect(r.json().data).toEqual({ prefix: "HMH", changed: 1 });
    expect(await app.db!.listing.findFirstOrThrow({ where: { slug: "house-1" } })).toMatchObject({ code: "HMH-0001", oldCodes: ["SP-0001"] });
    expect((await app.db!.listing.findFirstOrThrow({ where: { slug: "plot-2" } })).code).toBe("SP-0002"); // no business
    expect((await call("owner", "PUT", "/listings/code-prefix", { prefix: "HH" })).json().data.changed).toBe(1);
    expect(await app.db!.listing.findFirstOrThrow({ where: { slug: "house-1" } })).toMatchObject({ code: "HH-0001", oldCodes: ["SP-0001", "HMH-0001"] });
  });
});
