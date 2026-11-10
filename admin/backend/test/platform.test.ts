import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { billingSettings } from "@sheetal/backend-core/domain/billing";
import { PLATFORM_DEFAULTS, platformSettings, publicSite } from "@sheetal/backend-core/domain/platform";
import { buildApp } from "../src/app.js";

// A fake fetch: answers by address and remembers every call, so no test ever reaches a real service.
const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fake = vi.fn(async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
  const u = String(url);
  if (u.startsWith("https://maps.googleapis.com/")) return reply(200, { status: "OK" });
  if (u.startsWith("https://graph.facebook.com/")) return reply(200, { display_phone_number: "+977 980-0000000", verified_name: "Sheetal Property" });
  if (u.endsWith("/user/tokens/verify")) return reply(200, { success: true });
  if (u.includes("/zones/")) return reply(200, { result: { name: "sheetalproperty.com" } });
  return reply(404, {});
});

let app: FastifyInstance;
const tok: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
async function person(key: string, email: string, platformRole: string | null = null) {
  const u = await app.db!.user.create({ data: { email, userName: key, platformRole, passwordHash: "x" } });
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"), { fetch: fake as never });
  await app.db!.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs RESTART IDENTITY CASCADE`);
  await person("boss", "admin@sheetal.test", "super_admin");
  await person("finance", "finance@sheetal.test", "finance");
  await person("ops", "ops@sheetal.test", "operations");
});
afterAll(async () => { await app.close(); });

describe("platform settings", () => {
  it("start with the values the platform used before", async () => {
    const got = (await call("boss", "GET", "/admin/settings/platform")).json().data;
    expect(got).toMatchObject({ siteName: "Sheetal Property", vatRate: 13, graceDays: 7, trialDays: 0, autoSuspend: true, languages: ["en", "ne"], maintenance: { on: false }, canChangeSecurity: true });
    expect(await platformSettings(app.db!)).toEqual(PLATFORM_DEFAULTS);
    expect((await billingSettings(app.db!)).vatRate).toBe(13);
  });

  it("are for staff with settings.platform only", async () => {
    for (const who of ["ops", "finance"]) {
      expect((await call(who, "GET", "/admin/settings/platform")).statusCode).toBe(403);
      expect((await call(who, "PUT", "/admin/settings/platform", { vatRate: 1 })).statusCode).toBe(403);
    }
  });

  it("refuse bad values with 422", async () => {
    for (const bad of [{ vatRate: 40 }, { vatRate: -1 }, { supportEmail: "nope" }, { languages: [] }, { languages: ["fr"] }, { domains: { site: "https://sheetalproperty.com" } }, { trialDays: 1.5 }, { maxLoginAttempts: 1 }, { siteName: "x" }, { unknown: true }]) {
      expect((await call("boss", "PUT", "/admin/settings/platform", bad)).statusCode, JSON.stringify(bad)).toBe(422);
    }
    expect(await platformSettings(app.db!)).toEqual(PLATFORM_DEFAULTS);
  });

  it("save changes, write old → new to the audit log, and reach billing", async () => {
    const res = await call("boss", "PUT", "/admin/settings/platform", { vatRate: 15, graceDays: 10, trialDays: 14, autoSuspend: false, domains: { business: "app.sheetal.test" }, maintenance: { on: true, message: "Back at 6pm." }, sessionDays: 7 });
    expect(res.statusCode).toBe(200);
    const s = await billingSettings(app.db!);
    expect(s).toMatchObject({ vatRate: 15, graceDays: 10, autoSuspend: false });
    expect(await platformSettings(app.db!)).toMatchObject({ trialDays: 14, domains: { site: "sheetalproperty.com", business: "app.sheetal.test" }, maintenance: { on: true, message: "Back at 6pm." }, sessionDays: 7 });
    const rows = await app.db!.auditLog.findMany({ where: { action: "settings.platform" } });
    const targets = rows.map((r) => r.target);
    expect(targets).toContain("vatRate: 13 → 15");
    expect(targets).toContain("domains.business: business.sheetalproperty.com → app.sheetal.test");
    expect(targets).toContain("maintenance.on: false → true");
    expect((await call("boss", "PUT", "/admin/settings/platform", { vatRate: 15 })).json().message).toBe("Nothing changed.");
  });

  it("keep VAT in step when the billing page saves it", async () => {
    expect((await call("boss", "PUT", "/admin/settings/billing", { vatRate: 10, graceDays: 5, reminderDays: [3], bank: {} })).statusCode).toBe(200);
    expect((await call("boss", "GET", "/admin/settings/platform")).json().data).toMatchObject({ vatRate: 10, graceDays: 5 });
    expect(await billingSettings(app.db!)).toMatchObject({ vatRate: 10, graceDays: 5 });
  });

  it("show the website only public values", async () => {
    await call("boss", "PUT", "/admin/settings/integrations/google", { measurementId: "G-TEST12345", searchConsoleToken: "abcDEF123456_-", mapsKey: "maps-secret-key-123" });
    const site = await publicSite(app.db!);
    expect(site).toEqual({ siteName: "Sheetal Property", languages: ["en", "ne"], googleAnalyticsId: "G-TEST12345", searchConsoleToken: "abcDEF123456_-", maintenance: { on: true, message: "Back at 6pm." } });
    expect(JSON.stringify(site)).not.toContain("maps-secret");
    await call("boss", "PUT", "/admin/settings/platform", { maintenance: { on: false } });
    expect((await publicSite(app.db!)).maintenance).toEqual({ on: false, message: "" });
  });
});

describe("connections", () => {
  it("keep keys write-only and sealed", async () => {
    const secret = "EAAG-whatsapp-token-1234567890";
    expect((await call("ops", "PUT", "/admin/settings/integrations/whatsapp", { phoneId: "123456789", token: secret })).statusCode).toBe(403);
    expect((await call("boss", "PUT", "/admin/settings/integrations/whatsapp", { phoneId: "abc", token: secret })).statusCode).toBe(422);
    expect((await call("boss", "PUT", "/admin/settings/integrations/whatsapp", { phoneId: "123456789", token: "short" })).statusCode).toBe(422);
    expect((await call("boss", "PUT", "/admin/settings/integrations/nothing", {})).statusCode).toBe(404);
    const put = await call("boss", "PUT", "/admin/settings/integrations/whatsapp", { mode: "cloud", phoneId: "123456789", token: secret });
    expect(put.statusCode).toBe(200);
    for (const res of [put, await call("boss", "GET", "/admin/settings/integrations/whatsapp")]) {
      expect(res.body).not.toContain(secret);
      expect(res.json().data).toMatchObject({ phoneId: "123456789", mode: "cloud", hasToken: true, status: "review" });
    }
    const row = (await app.db!.appSetting.findUniqueOrThrow({ where: { key: "integration.whatsapp" } })).value as { token: string };
    expect(row.token.startsWith("v1:")).toBe(true);
    expect(JSON.stringify(await app.db!.auditLog.findMany())).not.toContain(secret);
    // an empty change keeps the key
    expect((await call("boss", "PUT", "/admin/settings/integrations/whatsapp", { phoneId: "123456789" })).json().message).toBe("Nothing changed.");
  });

  it("test each provider with the saved keys", async () => {
    fake.mockClear();
    const wa = (await call("boss", "POST", "/admin/settings/integrations/whatsapp/test")).json().data;
    expect(wa).toMatchObject({ ok: true });
    expect(wa.checks[0].message).toContain("Sheetal Property");
    const sent = fake.mock.calls[0]!;
    expect(String(sent[0])).toContain("https://graph.facebook.com/");
    expect((sent[1]!.headers as Record<string, string>).authorization).toBe("Bearer EAAG-whatsapp-token-1234567890");
    expect((await call("boss", "GET", "/admin/settings/integrations/whatsapp")).json().data).toMatchObject({ status: "done", lastTest: { ok: true } });

    expect((await call("boss", "POST", "/admin/settings/integrations/google/test")).json().data.ok).toBe(true);
    fake.mockImplementationOnce(async () => reply(200, { status: "REQUEST_DENIED", error_message: "The key is not allowed." }));
    const denied = (await call("boss", "POST", "/admin/settings/integrations/google/test")).json().data;
    expect(denied.ok).toBe(false);
    expect(denied.checks.find((c: { name: string }) => c.name === "Maps key").message).toBe("The key is not allowed.");

    expect((await call("boss", "POST", "/admin/settings/integrations/cloudflare/test")).statusCode).toBe(400); // nothing saved yet
    await call("boss", "PUT", "/admin/settings/integrations/cloudflare", { zoneId: "0123456789abcdef0123456789abcdef", apiToken: "cf-token-abcdefghijkl" });
    const cf = (await call("boss", "POST", "/admin/settings/integrations/cloudflare/test")).json().data;
    expect(cf.ok).toBe(true);
    expect(cf.checks.map((c: { name: string }) => c.name)).toEqual(["API token", "Zone"]);
    fake.mockImplementation(async () => { throw new Error("offline"); });
    const down = (await call("boss", "POST", "/admin/settings/integrations/cloudflare/test")).json().data;
    expect(down.ok).toBe(false);
    expect(down.checks[0].message).toContain("Couldn't reach");
  });

  it("test QR pairing as not available yet", async () => {
    await call("boss", "PUT", "/admin/settings/integrations/whatsapp", { mode: "qr" });
    const qr = (await call("boss", "POST", "/admin/settings/integrations/whatsapp/test")).json().data;
    expect(qr.ok).toBe(false);
    expect(qr.checks[0].message).toContain("QR pairing");
  });
});
