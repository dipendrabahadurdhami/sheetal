// Tests for Super Admin → Email: the live health of Sheetal's own mail domain, the mail server, and the test email.
// Where it fits: runs with the admin API tests (needs the throwaway PostgreSQL): npm run test -w @sheetal/admin-api
// How it works: a real admin API with a fake DNS and a fake mail port, so each state (all good, wrong MX, no reverse DNS, server down) can be set.
// Rules: only staff with settings access; a check re-reads DNS and saves the result like the business's own button; the test email is queued, audited and
// limited to a valid address; nothing secret is returned.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

const HOST = "mail.sheetal.test";
const KEY = "TESTPUBLICKEY1234567890";
let txt = new Map<string, string[]>();
let mx = new Map<string, { exchange: string; priority: number }[]>();
let a = new Map<string, string[]>();
let ptr = new Map<string, string[]>();
let smtpUp: boolean | null = true;
const dns = {
  resolveMx: async (n: string) => mx.get(n) ?? [],
  resolveTxt: async (n: string) => (txt.get(n) ?? []).map((v) => [v]),
  resolve4: async (n: string) => a.get(n) ?? [],
  reverse: async (ip: string) => ptr.get(ip) ?? [],
};
/** Every record present and right for the domain `sheetal.test`. */
const allGood = () => {
  txt = new Map([["_sheetal-verify.sheetal.test", ["sheetal-verify=tok123"]], ["sheetal.test", ["v=spf1 a:mail.sheetal.test ~all"]],
    ["sheetal._domainkey.sheetal.test", [`v=DKIM1; k=rsa; p=${KEY}`]], ["_dmarc.sheetal.test", ["v=DMARC1; p=quarantine"]]]);
  mx = new Map([["sheetal.test", [{ exchange: HOST, priority: 10 }]]]);
  a = new Map([[HOST, ["203.0.113.10"]]]);
  ptr = new Map([["203.0.113.10", [HOST]]]);
  smtpUp = true;
};

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
async function person(key: string, email: string, platformRole: string | null = null) {
  const u = await app.db!.user.create({ data: { email, userName: key, platformRole, passwordHash: "x", emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MAIL_HOST: HOST }, "admin"),
    { emailDns: dns, emailSmtp: async () => smtpUp });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, mail_domains, outbound_emails, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("boss", "admin@sheetal.test", "super_admin");
  await person("editor", "editor@sheetal.test", "content_editor");
  await person("owner1", "owner1@everest.test");
  await person("owner2", "owner2@hotel.test");
  const t1 = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner1!, name: "Sheetal Property", type: "agency", planId: "agency-business" }));
  const t2 = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner2!, name: "Hotel Nepal", type: "hotel", planId: "hotel-business" }));
  ids.own = (await db.mailDomain.create({ data: { tenantId: t1.id, name: "sheetal.test", verifyToken: "tok123", dkimSelector: "sheetal", dkimPublicKey: KEY, dkimPrivateKey: "sealed", verified: true } })).id;
  ids.other = (await db.mailDomain.create({ data: { tenantId: t2.id, name: "hotelnepal.test", verifyToken: "tok999", dkimSelector: "sheetal", dkimPublicKey: "OTHERKEY", dkimPrivateKey: "sealed" } })).id;
  ids.tenant1 = t1.id;
});
afterAll(async () => { await app.close(); });

describe("overview", () => {
  it("is for staff with settings access only", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/email/overview" })).statusCode).toBe(401);
    expect((await call("editor", "GET", "/admin/email/overview")).statusCode).toBe(403);
    expect((await call("owner1", "GET", "/admin/email/overview")).statusCode).toBe(403);
  });

  it("says the domain is connected and email is healthy when every record is right", async () => {
    allGood();
    const d = (await call("boss", "GET", "/admin/email/overview")).json().data;
    expect(d).toMatchObject({ platformDomain: "sheetal.test", mailHost: HOST, domainAdded: true, connected: true, problems: 0, healthy: true });
    expect(d.checks.map((c: { id: string }) => c.id)).toEqual(["verify", "mx", "spf", "dkim", "dmarc", "host", "ptr"]);
    expect(d.checks.every((c: { status: string }) => c.status === "ok")).toBe(true);
    expect(d.domains.map((x: { name: string; isPlatform: boolean }) => [x.name, x.isPlatform])).toEqual([["hotelnepal.test", false], ["sheetal.test", true]]);
    expect(d.domains.find((x: { name: string }) => x.name === "hotelnepal.test").business).toBe("Hotel Nepal");
    expect(JSON.stringify(d)).not.toMatch(/sealed|dkimPrivateKey|passwordHash/);
  });

  it("shows what is wrong: another provider's MX, and a missing reverse DNS", async () => {
    allGood();
    mx.set("sheetal.test", [{ exchange: "mx.zoho.test.", priority: 10 }]);
    ptr.delete("203.0.113.10");
    const d = (await call("boss", "GET", "/admin/email/overview")).json().data;
    const by = Object.fromEntries(d.checks.map((c: { id: string; status: string }) => [c.id, c.status]));
    expect(by).toMatchObject({ mx: "wrong", ptr: "missing", spf: "ok", dkim: "ok" });
    expect(d.checks.find((c: { id: string }) => c.id === "mx").detail).toContain("mx.zoho.test");
    expect(d.checks.find((c: { id: string }) => c.id === "ptr").fix).toMatch(/reverse DNS/i);
    expect(d).toMatchObject({ connected: false, healthy: false, problems: 2 });
  });

  it("an optional record (DMARC) missing is not a problem, and a mail server that does not answer makes email unhealthy", async () => {
    allGood();
    txt.delete("_dmarc.sheetal.test");
    const a1 = (await call("boss", "GET", "/admin/email/overview")).json().data;
    expect(a1.checks.find((c: { id: string }) => c.id === "dmarc")).toMatchObject({ status: "missing", optional: true });
    expect(a1).toMatchObject({ problems: 0, healthy: true });
    smtpUp = false;
    const a2 = (await call("boss", "GET", "/admin/email/overview")).json().data;
    expect(a2.server.listening).toBe(false);
    expect(a2).toMatchObject({ connected: true, healthy: false });
  });

  it("counts what waits, what failed today, and what arrived", async () => {
    allGood();
    const db = app.db!;
    await db.outboundEmail.createMany({ data: [
      { to: "a@x.test", subject: "Reset", text: "t", status: "sent", sentAt: new Date() },
      { to: "b@x.test", subject: "Invite", text: "t", status: "queued" },
      { to: "c@x.test", subject: "Verify", text: "t", status: "failed", error: "550 refused" },
    ] });
    const d = (await call("boss", "GET", "/admin/email/overview")).json().data;
    expect(d.server).toMatchObject({ waitingToSend: 1, failedLast24h: 1 });
    expect(d.server.lastSentAt).toBeTruthy();
    expect(d.healthy).toBe(false);                        // a failed email today is worth a look
    expect(d.recent.map((r: { subject: string }) => r.subject).sort()).toEqual(["Invite", "Reset", "Verify"]);
    expect(d.recent.every((r: Record<string, unknown>) => !("text" in r) && !("html" in r))).toBe(true);   // the text holds one-time links
  });
});

describe("check a domain", () => {
  it("re-reads DNS for any business's domain, saves the result and audits it", async () => {
    allGood();
    const bad = await call("boss", "POST", `/admin/email/domains/${ids.other}/check`);
    expect(bad.statusCode).toBe(200);
    expect(bad.json().data.verified).toBe(false);
    const row = await app.db!.mailDomain.findUniqueOrThrow({ where: { id: ids.other! } });
    expect(row.verified).toBe(false);
    expect(row.checks).toMatchObject({ verify: "missing", mx: "missing", spf: "missing", dkim: "missing" });
    expect(row.checkedAt).toBeTruthy();
    // Now the records of the platform's own domain: a check marks it verified.
    await app.db!.mailDomain.update({ where: { id: ids.own! }, data: { verified: false, checks: {} } });
    const ok = await call("boss", "POST", `/admin/email/domains/${ids.own}/check`);
    expect(ok.json()).toMatchObject({ data: { verified: true } });
    expect((await app.db!.mailDomain.findUniqueOrThrow({ where: { id: ids.own! } })).verified).toBe(true);
    expect(await app.db!.auditLog.count({ where: { action: "email.domain_checked" } })).toBe(2);
    expect((await call("editor", "POST", `/admin/email/domains/${ids.own}/check`)).statusCode).toBe(403);
    expect((await call("boss", "POST", "/admin/email/domains/nope/check")).statusCode).toBe(404);
  });
});

describe("send a test email", () => {
  it("queues it for the mail server, audits it, and refuses a bad address or an editor", async () => {
    const res = await call("boss", "POST", "/admin/email/test", { to: " Owner@Gmail.test " });
    expect(res.statusCode).toBe(200);
    const row = await app.db!.outboundEmail.findFirstOrThrow({ where: { subject: "Sheetal email test" } });
    expect(row).toMatchObject({ to: "owner@gmail.test", status: "queued" });
    expect(await app.db!.auditLog.count({ where: { action: "email.test_sent", target: "owner@gmail.test" } })).toBe(1);
    expect((await call("boss", "POST", "/admin/email/test", { to: "not-an-address" })).statusCode).toBe(422);
    expect((await call("editor", "POST", "/admin/email/test", { to: "x@y.test" })).statusCode).toBe(403);
  });
});
