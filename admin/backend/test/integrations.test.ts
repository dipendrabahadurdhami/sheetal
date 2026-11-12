// Tests for the Integration Center on the admin API (stage 1.3; INTEGRATIONS.md sections 4-6, 9, 11, 12, 14).
// Where it fits: runs with the admin API tests (needs the throwaway PostgreSQL): npm run test -w @sheetal/admin-api
// How it works: a real admin API with a fake fetch that answers by address. The tests walk a connection through its life (details -> test -> live ->
// staged change -> apply -> pause -> resume -> disconnect), check that no answer and no stored row ever carries a secret, that the old settings rows
// follow (so billing's gateways() and the old screens keep working), and that the migrate copy is idempotent and deletes nothing.
// Rules: only a staff role with platform.integration.manage may change a connection; secrets are write-only; test and live keys never mix.
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { gateways } from "@sheetal/backend-core/domain/billing";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { importLegacy } from "@sheetal/platform/integrations/legacy";
import { buildApp } from "../src/app.js";
import { adminJobs, adminPlatformJobs } from "../src/jobs.js";

const SECRETS_KEY = "test-secrets-key-for-the-integration-center-1";
const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let khaltiLive = 200;      // what "Khalti live" answers: flipped by the tests
let cloudflare = 200;
const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = String(url);
  const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
  if (u.startsWith("https://dev.khalti.com/")) return auth === "Key test-key-good" ? reply(404, { detail: "Not found." }) : reply(401, { detail: "Invalid token." });
  if (u.startsWith("https://khalti.com/")) return auth.startsWith("Key live-key") && khaltiLive === 200 ? reply(404, { detail: "Not found." }) : reply(401, { detail: "Invalid token." });
  if (u.startsWith("https://maps.googleapis.com/")) return reply(200, { status: "OK" });
  if (u.endsWith("/user/tokens/verify")) return cloudflare === 200 ? reply(200, { success: true }) : reply(cloudflare, { errors: [{ message: "Invalid API Token" }] });
  if (u.includes("/zones/")) return reply(200, { result: { name: "sheetalproperty.com" } });
  return reply(404, {});
});

let app: FastifyInstance;
const tok: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
async function person(key: string, email: string, platformRole: string | null = null) {
  const u = await app.db!.user.create({ data: { email, userName: key, platformRole, passwordHash: "x" } });
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
const vault = new Vault(SECRETS_KEY, false);
const everything = async () => JSON.stringify([
  await app.db!.integrationConnection.findMany(), await app.db!.integrationTestLog.findMany(), await app.db!.auditLog.findMany(), await app.db!.notification.findMany(),
]);

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", SECRETS_KEY }, "admin"), { fetch: fake as never });
  await app.db!.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, notifications, integration_connections, help_guides RESTART IDENTITY CASCADE`);
  await person("boss", "admin@sheetal.test", "super_admin");
  await person("finance", "finance@sheetal.test", "finance");
  await person("nobody", "visitor@sheetal.test", null);
});
afterAll(async () => { await app.close(); });

describe("integration center: who may", () => {
  it("lists every platform integration as 'not set up', built ones and shells", async () => {
    const res = await call("boss", "GET", "/admin/integrations");
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as { spec: { id: string; built: boolean }; connection: { state: string }; steps: { id: string; done: boolean }[] }[];
    const ids = rows.map((r) => r.spec.id);
    for (const id of ["esewa", "khalti", "fonepay", "google", "whatsapp", "cloudflare", "ai.anthropic", "email", "sms"]) expect(ids, id).toContain(id);
    expect(ids).not.toContain("delivery.pathao");                 // a business-only integration
    expect(rows.every((r) => r.connection.state === "none")).toBe(true);
    expect(rows.find((r) => r.spec.id === "khalti")!.steps.every((s) => !s.done)).toBe(true);
    expect(res.json().meta.canManage).toBe(true);
  });
  it("refuses staff without the permission and people who are not staff", async () => {
    expect((await call("finance", "GET", "/admin/integrations")).statusCode).toBe(403);
    expect((await call("finance", "PUT", "/admin/integrations/khalti", { values: { secretKey: "x" } })).statusCode).toBe(403);
    expect((await call("nobody", "GET", "/admin/integrations")).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/admin/integrations" })).statusCode).toBe(401);
    expect((await call("boss", "GET", "/admin/integrations/delivery.pathao")).statusCode).toBe(404);
    expect((await call("boss", "GET", "/admin/integrations/nope")).statusCode).toBe(404);
  });
});

describe("integration center: the life of a connection (Khalti)", () => {
  it("checks shapes, refuses unknown fields and extra body fields", async () => {
    expect((await call("boss", "PUT", "/admin/integrations/khalti", { values: { colour: "red" } })).statusCode).toBe(422);
    expect((await call("boss", "PUT", "/admin/integrations/khalti", { values: {}, tenantId: "x" })).statusCode).toBe(422);
    expect((await call("boss", "POST", "/admin/integrations/khalti/test")).statusCode).toBe(400);     // nothing entered yet
  });

  it("saves the test key sealed and bound, and never returns it", async () => {
    const res = await call("boss", "PUT", "/admin/integrations/khalti", { values: { secretKey: "test-key-bad" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.connection).toMatchObject({ state: "details_entered", mode: "test", has: { test: ["secretKey"], live: [], staged: [] } });
    expect(res.body).not.toContain("test-key-bad");
    const row = await app.db!.integrationConnection.findFirstOrThrow({ where: { integrationId: "khalti" }, include: { secrets: true } });
    const sealed = (row.secrets[0]!.sealed as Record<string, string>).secretKey!;
    expect(sealed.startsWith("v2:")).toBe(true);
    expect(vault.open(sealed, `${row.id}:test:secretKey`)).toBe("test-key-bad");
    expect(() => vault.open(sealed, `${row.id}:live:secretKey`)).toThrow();
  });

  it("a failing test is logged and blocks going live; a new key resets, then the test passes", async () => {
    const bad = await call("boss", "POST", "/admin/integrations/khalti/test");
    expect(bad.json().data).toMatchObject({ ok: false, connection: { state: "test_failed", lastTestOk: false } });
    expect((await call("boss", "POST", "/admin/integrations/khalti/go-live")).statusCode).toBe(400);
    expect((await call("boss", "PUT", "/admin/integrations/khalti", { values: { secretKey: "live-key-1" }, mode: "live" })).statusCode).toBe(400);   // live details only after a passing test
    await call("boss", "PUT", "/admin/integrations/khalti", { values: { secretKey: "test-key-good" } });
    const ok = await call("boss", "POST", "/admin/integrations/khalti/test");
    expect(ok.json().data).toMatchObject({ ok: true, connection: { state: "test_passed" } });
    const log = (await call("boss", "GET", "/admin/integrations/khalti/log")).json().data as { ok: boolean; kind: string }[];
    expect(log.map((l) => l.ok)).toEqual([true, false]);
  });

  it("in test mode the old payment settings follow, so billing can use the test gateway outside production", async () => {
    const g = await gateways(app.db!, vault, false);
    expect(g.khalti).toEqual({ mode: "test", secretKey: "test-key-good" });
  });

  it("goes live only with live details that pass a live probe; test and live keys stay apart", async () => {
    expect((await call("boss", "POST", "/admin/integrations/khalti/go-live")).json().message).toMatch(/Save the live details first/);
    const saved = await call("boss", "PUT", "/admin/integrations/khalti", { values: { secretKey: "live-key-1" }, mode: "live" });
    expect(saved.json().data.connection).toMatchObject({ state: "test_passed", mode: "test", has: { test: ["secretKey"], live: ["secretKey"] } });
    khaltiLive = 401;
    const refused = await call("boss", "POST", "/admin/integrations/khalti/go-live");
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toMatch(/live details did not pass/);
    expect((await app.db!.integrationConnection.findFirstOrThrow({ where: { integrationId: "khalti" } })).state).toBe("test_passed");
    khaltiLive = 200;
    const live = await call("boss", "POST", "/admin/integrations/khalti/go-live");
    expect(live.statusCode).toBe(200);
    expect(live.json().data.connection).toMatchObject({ state: "live", mode: "live", health: { status: "healthy" } });
    expect((await gateways(app.db!, vault, true)).khalti).toEqual({ mode: "live", secretKey: "live-key-1" });
    const liveCalls = fake.mock.calls.filter((c) => String(c[0]).startsWith("https://khalti.com/"));
    expect(liveCalls.every((c) => (c[1]!.headers as Record<string, string>).Authorization !== "Key test-key-good")).toBe(true);   // the test key never reached the live host
  });

  it("a change to a live connection waits, is tested on its own, and only then replaces the live key", async () => {
    const staged = await call("boss", "PUT", "/admin/integrations/khalti", { values: { secretKey: "wrong-key" } });
    expect(staged.json().data.connection).toMatchObject({ state: "live", has: { staged: ["secretKey"] } });
    expect((await gateways(app.db!, vault, true)).khalti!.secretKey).toBe("live-key-1");           // untouched
    expect((await call("boss", "POST", "/admin/integrations/khalti/apply")).statusCode).toBe(400);         // not tested yet
    const t1 = await call("boss", "POST", "/admin/integrations/khalti/test?staged=1");
    expect(t1.json().data.ok).toBe(false);
    expect((await call("boss", "POST", "/admin/integrations/khalti/apply")).statusCode).toBe(400);
    await call("boss", "PUT", "/admin/integrations/khalti", { values: { secretKey: "live-key-2" } });
    expect((await call("boss", "POST", "/admin/integrations/khalti/test?staged=1")).json().data).toMatchObject({ ok: true, stagedTested: true });
    const applied = await call("boss", "POST", "/admin/integrations/khalti/apply");
    expect(applied.statusCode).toBe(200);
    expect(applied.json().data.connection).toMatchObject({ state: "live", stagedConfig: null, has: { staged: [] } });
    expect((await gateways(app.db!, vault, true)).khalti!.secretKey).toBe("live-key-2");
    expect(await app.db!.integrationSecretSet.count({ where: { status: "retired" } })).toBe(1);            // the old key is kept 30 days
  });

  it("pause needs a reason, switches the gateway off everywhere, and resume brings it back", async () => {
    expect((await call("boss", "POST", "/admin/integrations/khalti/pause", { reason: "x" })).statusCode).toBe(400);
    const paused = await call("boss", "POST", "/admin/integrations/khalti/pause", { reason: "Khalti asked us to stop for maintenance" });
    expect(paused.json().data.connection).toMatchObject({ state: "paused", pauseReason: "Khalti asked us to stop for maintenance" });
    expect((await gateways(app.db!, vault, true)).khalti).toBeNull();
    expect(await app.integrations!.resolve({ scope: "platform", tenantId: null }, "khalti")).toBeNull();
    expect((await call("boss", "POST", "/admin/integrations/khalti/go-live")).statusCode).toBe(400);
    const back = await call("boss", "POST", "/admin/integrations/khalti/resume");
    expect(back.json().data.connection.state).toBe("live");
    const use = await app.integrations!.resolve({ scope: "platform", tenantId: null }, "khalti");
    expect(use?.mode).toBe("live");
    expect(use?.secrets.get("secretKey")).toBe("live-key-2");
  });

  it("the old payment settings screen still works and the connection follows it (alias)", async () => {
    const res = await call("boss", "PUT", "/admin/settings/payments", { esewa: { enabled: false, mode: "test" }, khalti: { enabled: false, mode: "live" }, fonepay: { enabled: false, mode: "test" }, manual: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect((await app.db!.integrationConnection.findFirstOrThrow({ where: { integrationId: "khalti" } })).state).toBe("paused");
  });

  it("disconnect deletes the keys and keeps the log", async () => {
    const res = await call("boss", "DELETE", "/admin/integrations/khalti");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.connection).toMatchObject({ state: "draft", has: { test: [], live: [], staged: [] } });
    const row = await app.db!.integrationConnection.findFirstOrThrow({ where: { integrationId: "khalti" } });
    expect(await app.db!.integrationSecretSet.count({ where: { connectionId: row.id } })).toBe(0);
    expect(await app.db!.integrationTestLog.count({ where: { connectionId: row.id } })).toBeGreaterThan(3);
    expect((await gateways(app.db!, vault, false)).khalti).toBeNull();
  });

  it("no secret ever appears in a connection row, a log row, an audit row or a notice", async () => {
    const all = await everything();
    for (const secret of ["test-key-bad", "test-key-good", "live-key-1", "live-key-2", "wrong-key"]) expect(all, secret).not.toContain(secret);
    const audits = await app.db!.auditLog.findMany({ where: { action: { startsWith: "integration.khalti." } } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["integration.khalti.saved", "integration.khalti.tested", "integration.khalti.went_live", "integration.khalti.paused", "integration.khalti.resumed", "integration.khalti.applied", "integration.khalti.disconnected"]));
    expect(audits.every((a) => !!a.actorId)).toBe(true);
  });
});

describe("integration center: a single-mode connection (Cloudflare) and its old row", () => {
  it("details -> test -> live, and the old settings row is written only when live", async () => {
    const zone = "0123456789abcdef0123456789abcdef";
    expect((await call("boss", "PUT", "/admin/integrations/cloudflare", { values: { zoneId: "short" } })).statusCode).toBe(422);
    const saved = await call("boss", "PUT", "/admin/integrations/cloudflare", { values: { zoneId: zone, apiToken: "cf-token-abc" } });
    expect(saved.json().data.connection).toMatchObject({ state: "details_entered", mode: "live", has: { live: ["apiToken"] } });
    expect(((await app.db!.appSetting.findUnique({ where: { key: "integration.cloudflare" } }))?.value ?? {})).toEqual({});
    expect((await call("boss", "POST", "/admin/integrations/cloudflare/test")).json().data.ok).toBe(true);
    expect((await call("boss", "POST", "/admin/integrations/cloudflare/go-live")).statusCode).toBe(200);
    const old = (await app.db!.appSetting.findUniqueOrThrow({ where: { key: "integration.cloudflare" } })).value as Record<string, string>;
    expect(old.zoneId).toBe(zone);
    expect(old.apiToken!.startsWith("v1:")).toBe(true);            // the old readers get the old format
    expect(vault.open(old.apiToken!)).toBe("cf-token-abc");
    const view = await call("boss", "GET", "/admin/settings/integrations/cloudflare");     // the old screen's route still answers, without the secret
    expect(view.statusCode).toBe(200);
    expect(view.json().data.zoneId).toBe(zone);
    expect(view.body).not.toContain("cf-token-abc");
  });

  it("the health job tells staff once after three failures, never pauses, and clears on the first success", async () => {
    expect(adminJobs(app).map((j) => j.id)).not.toContain("integrations.health");            // the pinned list is unchanged
    const job = adminPlatformJobs(app, app.integrations!).find((j) => j.id === "integrations.health")!;
    expect(job.everyMs).toBe(15 * 60_000);
    cloudflare = 403;
    await job.run(); await job.run();
    let row = await app.db!.integrationConnection.findFirstOrThrow({ where: { integrationId: "cloudflare" } });
    expect(row).toMatchObject({ state: "live", healthStatus: "degraded", healthFailures: 2 });
    expect(await app.db!.notification.count({ where: { type: "integration.health" } })).toBe(0);
    await job.run(); await job.run();
    row = await app.db!.integrationConnection.findFirstOrThrow({ where: { integrationId: "cloudflare" } });
    expect(row).toMatchObject({ state: "live", healthStatus: "down" });                       // down, not paused
    expect(await app.db!.notification.count({ where: { type: "integration.health" } })).toBe(1);   // told once (one staff member holds the permission)
    expect(await app.integrations!.resolve({ scope: "platform", tenantId: null }, "cloudflare")).toBeNull();
    cloudflare = 200;
    await job.run();
    row = await app.db!.integrationConnection.findFirstOrThrow({ where: { integrationId: "cloudflare" } });
    expect(row).toMatchObject({ healthStatus: "healthy", healthFailures: 0 });
    expect(await app.db!.notification.count({ where: { type: "integration.health" } })).toBe(2);   // "back to normal"
  });

  it("a shell can be filled in but not tested into a pass or switched on", async () => {
    const saved = await call("boss", "PUT", "/admin/integrations/ai.anthropic", { values: { apiKey: "sk-ant-abc", model: "claude" } });
    expect(saved.json().data.connection.state).toBe("details_entered");
    expect((await call("boss", "POST", "/admin/integrations/ai.anthropic/test")).json().data).toMatchObject({ ok: false, connection: { state: "test_failed" } });
    expect((await call("boss", "POST", "/admin/integrations/ai.anthropic/go-live")).statusCode).toBe(400);
  });

  it("serves the built-in guide, and a published edited guide wins", async () => {
    const built = (await call("boss", "GET", "/admin/integrations/cloudflare/guide")).json().data;
    expect(built.edited).toBe(false);
    expect(built.steps.length).toBeGreaterThan(1);
    await app.db!.helpGuide.create({ data: { key: "guide.integration.cloudflare.platform", lang: "en", title: "Our Cloudflare steps", steps: [{ title: "One", body: "Do this." }], status: "published" } });
    expect((await call("boss", "GET", "/admin/integrations/cloudflare/guide?lang=ne")).json().data).toMatchObject({ title: "Our Cloudflare steps", edited: true, lang: "en" });
  });
});

describe("integrations:migrate (old rows -> connections)", () => {
  it("copies sealed values unopened, maps the states, is idempotent and deletes nothing", async () => {
    const db = app.db!;
    await db.$executeRawUnsafe(`TRUNCATE integration_connections, app_settings RESTART IDENTITY CASCADE`);
    const sealedKey = vault.seal("esewa-live-secret");
    const sealedMaps = vault.seal("maps-key-1");
    await db.appSetting.create({ data: { key: "payments", value: { esewa: { enabled: true, mode: "live", productCode: "SHEETAL", secretKey: sealedKey }, khalti: { enabled: true, mode: "test", secretKey: vault.seal("kh-test") }, fonepay: { enabled: false, mode: "test" }, manual: { enabled: true } } } });
    await db.appSetting.create({ data: { key: "integration.google", value: { measurementId: "G-ABC123XYZ", mapsKey: sealedMaps, lastTest: { at: "2026-11-01T00:00:00.000Z", ok: false } } } });
    const before = JSON.stringify(await db.appSetting.findMany({ orderBy: { key: "asc" } }));

    const first = await importLegacy(db);
    expect(Object.fromEntries(first.map((r) => [r.id, r.result]))).toEqual({ esewa: "created", khalti: "created", fonepay: "skipped", google: "created", whatsapp: "skipped", cloudflare: "skipped" });
    const esewa = await db.integrationConnection.findFirstOrThrow({ where: { integrationId: "esewa" }, include: { secrets: true } });
    expect(esewa).toMatchObject({ state: "live", mode: "live", scope: "platform", ownerKey: "platform" });
    expect(esewa.config).toEqual({ productCode: "SHEETAL" });
    expect((esewa.secrets[0]!.sealed as Record<string, string>).secretKey).toBe(sealedKey);         // the very same sealed string
    expect((await db.integrationConnection.findFirstOrThrow({ where: { integrationId: "khalti" } }))).toMatchObject({ state: "details_entered", mode: "test" });
    const google = await db.integrationConnection.findFirstOrThrow({ where: { integrationId: "google" } });
    expect(google).toMatchObject({ state: "live", healthStatus: "degraded", lastTestOk: false });
    expect(await db.integrationTestLog.count({ where: { connectionId: google.id } })).toBe(1);

    // The migrated live key works through the Integration Center (an old-format value opens at its new place).
    expect((await app.integrations!.resolve({ scope: "platform", tenantId: null }, "esewa"))?.secrets.get("secretKey")).toBe("esewa-live-secret");

    const second = await importLegacy(db);
    expect(second.every((r) => r.result === "skipped")).toBe(true);
    expect(await db.integrationConnection.count()).toBe(3);
    expect(JSON.stringify(await db.appSetting.findMany({ orderBy: { key: "asc" } }))).toBe(before);   // the old rows are untouched
    expect((await gateways(db, vault, true)).esewa).toEqual({ mode: "live", productCode: "SHEETAL", secretKey: "esewa-live-secret" });
  });

  it("the old Google settings route is an alias: saving there refreshes the connection", async () => {
    const res = await call("boss", "PUT", "/admin/settings/integrations/google", { measurementId: "G-NEW456XYZ" });
    expect(res.statusCode).toBe(200);
    const google = await app.db!.integrationConnection.findFirstOrThrow({ where: { integrationId: "google" } });
    expect((google.config as Record<string, string>).measurementId).toBe("G-NEW456XYZ");
    expect(google.state).toBe("live");
  });
});
