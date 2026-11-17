// Tests for "Add the records for me" (Settings → Domain and email): the plan of what Cloudflare will get, applying it, and the safety rules.
// Where it fits: runs with the business API tests (npm run test -w @sheetal/business-api). A fake Cloudflare zone and a fake DNS stand in for the internet.
// Rules: a plan changes nothing; adds always happen; replacing old MX or SPF needs "replace: true"; only the exact domain of the connected zone;
// nothing without Cloudflare connected; only owners and managers; the token never appears in an answer.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

type Rec = { id: string; type: string; name: string; content: string; priority?: number };
let zoneRecords: Rec[] = [];
let nextId = 1;
let connected: { token: string; zoneId: string } | null = { token: "cf-secret-token-for-tests", zoneId: "z".repeat(32) };
let zoneName = "everest.test";
const seen: string[] = [];

/** A tiny Cloudflare: zone lookup, list by name, add, change, remove. */
const cloudflareFetch = async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
  const method = init?.method ?? "GET";
  seen.push(`${method} ${url.replace("https://api.cloudflare.com/client/v4", "")}`);
  const ok = (result: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, result }) });
  const u = new URL(url);
  const m = /\/zones\/[^/]+(\/dns_records(?:\/([\w-]+))?)?$/.exec(u.pathname);
  if (!m) return { ok: false, status: 404, json: async () => ({ success: false, errors: [{ message: "bad path" }] }) };
  if (!m[1]) return ok({ name: zoneName });
  if (method === "GET") return ok(zoneRecords.filter((r) => r.name === u.searchParams.get("name")));
  if (method === "POST") { const b = JSON.parse(init!.body!); zoneRecords.push({ id: `r${nextId++}`, ...b }); return ok({}); }
  if (method === "PUT") { const b = JSON.parse(init!.body!); zoneRecords = zoneRecords.map((r) => (r.id === m[2] ? { id: r.id, ...b } : r)); return ok({}); }
  zoneRecords = zoneRecords.filter((r) => r.id !== m[2]); return ok({});
};
// The fake DNS reads the fake zone, so "Check records" sees what was added.
const resolver = {
  resolveMx: async (n: string) => zoneRecords.filter((r) => r.type === "MX" && r.name === n).map((r) => ({ exchange: r.content, priority: r.priority ?? 10 })),
  resolveTxt: async (n: string) => zoneRecords.filter((r) => r.type === "TXT" && r.name === n).map((r) => [r.content.replace(/^"|"$/g, "")]),
};

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.tenant! } });
const reset = () => {
  nextId = 1; seen.length = 0;
  // What the owner has today: the old provider's three MX and SPF (quoted, as Cloudflare shows TXT), plus unrelated records that must survive.
  zoneRecords = [
    { id: "old-mx1", type: "MX", name: "everest.test", content: "mx.zoho.test", priority: 10 },
    { id: "old-mx2", type: "MX", name: "everest.test", content: "mx2.zoho.test", priority: 20 },
    { id: "old-spf", type: "TXT", name: "everest.test", content: "\"v=spf1 include:zohomail.test ~all\"" },
    { id: "keep-google", type: "TXT", name: "everest.test", content: "\"google-site-verification=abc\"" },
    { id: "keep-a", type: "A", name: "everest.test", content: "45.117.153.121" },
    { id: "keep-zdkim", type: "TXT", name: "zmail._domainkey.everest.test", content: "\"v=DKIM1; k=rsa; p=OLD\"" },
  ];
};

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), MAIL_HOST: "mail.sheetal.test" }, "business"),
    { resolver, cloudflare: async () => connected, cloudflareFetch: cloudflareFetch as never });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, mail_domains RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, email] of [["owner", "owner@everest.test"], ["agent", "sita@everest.test"]] as const) {
    const u = await db.user.create({ data: { email, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  const t = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }));
  ids.tenant = t.id;
  const agentRole = await db.role.findFirstOrThrow({ where: { tenantId: t.id, key: "agent" } });
  await db.membership.create({ data: { userId: ids.agent!, tenantId: t.id, roleId: agentRole.id } });
  ids.domain = (await call("owner", "POST", "/mail/domains", { name: "everest.test" })).json().data.id;
});
afterAll(async () => { await app.close(); });

describe("add the records for me", () => {
  it("plans without changing anything, and says what is replaced", async () => {
    reset();
    const res = await call("owner", "POST", `/mail/domains/${ids.domain}/dns/auto`, {});
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json().data;
    expect(d.applied).toBe(false);
    expect(d.plan.needsConfirm).toBe(true);
    const by = Object.fromEntries(d.plan.items.map((i: { id: string; action: string }) => [i.id, i.action]));
    expect(by).toEqual({ verify: "add", mx: "replace", spf: "replace", dkim: "add", dmarc: "add" });
    expect(d.plan.items.find((i: { id: string }) => i.id === "mx").current).toEqual(["10 mx.zoho.test", "20 mx2.zoho.test"]);
    expect(seen.every((s) => s.startsWith("GET"))).toBe(true);        // a plan only reads
    expect(zoneRecords).toHaveLength(6);
    expect(JSON.stringify(res.json())).not.toContain("cf-secret-token-for-tests");
  });

  it("adds the new records but leaves the old MX and SPF until the owner says replace", async () => {
    reset();
    const res = await call("owner", "POST", `/mail/domains/${ids.domain}/dns/auto`, { apply: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().message).toMatch(/need your OK/);
    const names = zoneRecords.map((r) => `${r.type} ${r.name}`);
    expect(names).toContain("TXT _sheetal-verify.everest.test");
    expect(names.filter((n) => n.includes("_domainkey")).sort()).toEqual(["TXT sheetal._domainkey.everest.test", "TXT zmail._domainkey.everest.test"]);
    expect(names).toContain("TXT _dmarc.everest.test");
    expect(zoneRecords.filter((r) => r.type === "MX").map((r) => r.content).sort()).toEqual(["mx.zoho.test", "mx2.zoho.test"]);   // untouched
    expect(zoneRecords.find((r) => r.id === "old-spf")!.content).toContain("zohomail");
  });

  it("replaces the old MX and SPF when asked, keeps everything else, and the domain turns ready", async () => {
    // continues from the zone state of the previous test (verify, DKIM and DMARC already added)
    const res = await call("owner", "POST", `/mail/domains/${ids.domain}/dns/auto`, { apply: true, replace: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(zoneRecords.filter((r) => r.type === "MX").map((r) => `${r.priority} ${r.content}`)).toEqual(["10 mail.sheetal.test"]);
    const spf = zoneRecords.filter((r) => r.type === "TXT" && r.name === "everest.test" && r.content.replace(/"/g, "").startsWith("v=spf1"));
    expect(spf).toHaveLength(1);
    expect(spf[0]!.content).toBe("v=spf1 a:mail.sheetal.test ~all");
    expect(zoneRecords.find((r) => r.id === "keep-google")).toBeTruthy();
    expect(zoneRecords.find((r) => r.id === "keep-a")).toBeTruthy();
    expect(zoneRecords.find((r) => r.id === "keep-zdkim")!.content).toContain("OLD");
    expect(res.json().data.domain).toMatchObject({ verified: true });
  });

  it("does nothing the second time", async () => {
    seen.length = 0;
    const res = await call("owner", "POST", `/mail/domains/${ids.domain}/dns/auto`, { apply: true, replace: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.results.every((r: { done: string }) => r.done === "already right")).toBe(true);
    expect(seen.some((s) => !s.startsWith("GET"))).toBe(false);
  });

  it("refuses without Cloudflare, for another domain's zone, and for a team member who is not a manager", async () => {
    connected = null;
    const off = await call("owner", "POST", `/mail/domains/${ids.domain}/dns/auto`, {});
    expect(off.statusCode).toBe(409);
    expect(off.json().message).toMatch(/Cloudflare/);
    connected = { token: "cf-secret-token-for-tests", zoneId: "z".repeat(32) };
    zoneName = "other-site.test";
    const wrong = await call("owner", "POST", `/mail/domains/${ids.domain}/dns/auto`, { apply: true, replace: true });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().message).toMatch(/other-site\.test/);
    zoneName = "everest.test";
    expect((await call("agent", "POST", `/mail/domains/${ids.domain}/dns/auto`, {})).statusCode).toBe(403);
  });
});
