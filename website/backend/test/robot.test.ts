// The robot check on public forms (src/modules/robot/hook.ts): off without keys; with keys, the guarded forms need a token Cloudflare passes
// (header x-captcha or a captcha field), GET /site gives the public site key, and /public/leads (API key) is never asked.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { Vault } from "@sheetal/platform/auth/vault";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let asked = 0;
const fakeFetch = (async (_url: string, init: { body: URLSearchParams }) => {
  asked++;
  return new Response(JSON.stringify({ success: init.body.get("response") === "good" }), { headers: { "content-type": "application/json" } });
}) as never;
const contact = (headers: Record<string, string> = {}, extra: object = {}) =>
  app.inject({ method: "POST", url: "/v1/contact", headers, payload: { name: "Ram Shrestha", email: "ram@robot.test", phone: "9800000000", message: "Please call me about a flat.", ...extra }, remoteAddress: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "website"), { fetch: fakeFetch });
  await app.db!.$executeRawUnsafe(`DELETE FROM app_settings WHERE key = 'captcha'`);
});
afterAll(async () => {
  await app.db!.$executeRawUnsafe(`DELETE FROM app_settings WHERE key = 'captcha'`);
  await app.close();
});

describe("robot check", () => {
  it("is off without keys: forms work as before and /site says so", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/site" })).json().data.captcha).toBeNull();
    const r = await contact();
    expect(r.statusCode).not.toBe(400);
    expect(asked).toBe(0);
  });

  it("with keys: no token or a bad one is refused; a good one (header or field) passes; /site gives the public key only", async () => {
    await app.db!.appSetting.create({ data: { key: "captcha", value: { siteKey: "0x4AAAAsite", secret: new Vault(undefined, false).seal("0x4AAAAsecret") } } });
    const site = (await app.inject({ method: "GET", url: "/v1/site" })).json().data;
    expect(site.captcha).toBe("0x4AAAAsite");
    expect(JSON.stringify(site)).not.toContain("secret");

    const none = await contact();
    expect(none.statusCode).toBe(400);
    expect(none.json().message).toMatch(/robot/);
    expect((await contact({ "x-captcha": "bad" })).statusCode).toBe(400);
    expect((await contact({ "x-captcha": "good" })).statusCode).not.toBe(400);
    expect((await contact({}, { captcha: "good" })).statusCode).not.toBe(400);
    // Sign-in is guarded too.
    expect((await app.inject({ method: "POST", url: "/v1/login", payload: { email: "x@robot.test", password: "whatever1" } })).json().message).toMatch(/robot/);
    // Reading is never asked; /public/leads (businesses' own websites, API key) is never asked.
    expect((await app.inject({ method: "GET", url: "/v1/jobs" })).statusCode).toBe(200);
    const before = asked;
    const leads = await app.inject({ method: "POST", url: "/v1/public/leads", payload: { name: "Ram", message: "Hello there" } });
    expect(leads.json().message ?? "").not.toMatch(/robot/);
    expect(asked).toBe(before);
  });
});
