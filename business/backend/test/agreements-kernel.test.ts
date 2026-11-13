// Tests for Agreements on the kernel (P2-W1 stage 3): what the move to apps/agreements/backend added. agreements.test.ts (the old tests) is NOT repeated here
// and passes unchanged. The website signing flow is not moved and keeps its own tests.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: covers the kernel columns (version, updatedBy), version conflict on a draft save (409), the events in the same transaction, the new audit line for a
// draft save, isolation (another business), and that a removed draft is really gone with its signers.
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
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.agency! } });
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { tenantId: ids.agency, name } });
const edit = (d: { title: string; lang: string; values: object; bodyEn: string; bodyNe: string; signers: object[] }, over: object = {}) =>
  ({ title: d.title, lang: d.lang, values: d.values, bodyEn: d.bodyEn, bodyNe: d.bodyNe, signers: d.signers, ...over });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, event_outbox, agreements, agreement_signers RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "stranger"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-ag.test`, userName: `ka-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.other = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.stranger!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
});
afterAll(async () => { await app.close(); });

describe("Agreements on the kernel", () => {
  it("writes the kernel columns and an event with a new draft, and bumps the version on a save", async () => {
    const id = (await call("owner", "POST", "/agreements", { kind: "blank", lang: "en" })).json().data.id as string;
    expect(await app.db!.agreement.findUniqueOrThrow({ where: { id } })).toMatchObject({ version: 1, createdBy: ids.owner, updatedBy: ids.owner, deletedAt: null });
    expect((await events("agreements.agreement.created")).map((e) => (e.payload as { id: string }).id)).toContain(id);
    const d = (await call("owner", "GET", `/agreements/${id}`)).json().data;
    expect(d.version).toBe(1);
    const saved = await call("owner", "PUT", `/agreements/${id}`, edit(d, { title: "Changed", version: 1 }));
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.version).toBe(2);
    expect(await app.db!.auditLog.count({ where: { tenantId: ids.agency, action: "agreement.updated" } })).toBe(1);
    expect(await events("agreements.agreement.updated")).toHaveLength(1);
    ids.draft = id;
  });

  it("refuses a save made on an old version (409) and changes nothing", async () => {
    const d = (await call("owner", "GET", `/agreements/${ids.draft}`)).json().data;
    const stale = await call("owner", "PUT", `/agreements/${ids.draft}`, edit(d, { title: "Stale", version: 1 }));
    expect(stale.statusCode).toBe(409);
    expect((await app.db!.agreement.findUniqueOrThrow({ where: { id: ids.draft } })).title).toBe("Changed");
  });

  it("never shows or changes another business's agreements", async () => {
    expect((await call("stranger", "GET", `/agreements/${ids.draft}`, undefined, ids.other)).statusCode).toBe(404);
    expect((await call("stranger", "DELETE", `/agreements/${ids.draft}`, undefined, ids.other)).statusCode).toBe(404);
    expect((await call("stranger", "GET", "/agreements", undefined, ids.other)).json().data.rows).toEqual([]);
  });

  it("really removes a draft with its signers, with an event", async () => {
    expect((await call("owner", "DELETE", `/agreements/${ids.draft}`)).statusCode).toBe(200);
    expect(await app.db!.agreement.findUnique({ where: { id: ids.draft! } })).toBeNull();
    expect(await app.db!.agreementSigner.count({ where: { agreementId: ids.draft! } })).toBe(0);
    expect(await events("agreements.agreement.removed")).toHaveLength(1);
  });
});
