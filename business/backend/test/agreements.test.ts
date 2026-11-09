import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object, tenant = ids.agency) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant! } });
const edit = (d: { title: string; lang: string; values: object; bodyEn: string; bodyNe: string; signers: object[] }, over: object = {}) => ({ title: d.title, lang: d.lang, values: d.values, bodyEn: d.bodyEn, bodyNe: d.bodyNe, signers: d.signers, ...over });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, leads, rent_owners, rent_units, rent_leases, agreements, agreement_signers RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "manager", "agent", "pokhara", "free"]) {
    const u = await db.user.create({ data: { email: `${k}@ag.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.freeBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.free!, name: "Small Office", type: "agency", planId: "agency-starter" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  ids.pokharaBranch = (await db.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } })).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.manager!, roleId: (await role("branch_manager")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await role("agent")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.pokhara!, roleId: (await role("branch_manager")).id, status: "active", scopes: ["Pokhara"] } });
  const owner = await db.rentOwner.create({ data: { tenantId: ids.agency!, branchId: ids.head!, name: "Hari Shrestha", email: "hari@owner.test", phone: "9801111111", feeBp: 800 } });
  const unit = await db.rentUnit.create({ data: { tenantId: ids.agency!, branchId: ids.head!, ownerId: owner.id, property: "Shrestha Niwas", name: "Flat 2", kind: "Flat", rent: 25000, status: "let" } });
  ids.lease = (await db.rentLease.create({ data: { tenantId: ids.agency!, branchId: ids.head!, unitId: unit.id, renter: "Sita Sharma", email: "sita@renter.test", phone: "9802222222", startOn: new Date("2026-12-01"), endOn: new Date("2027-11-30"), rent: 25000, deposit: 50000, dueDay: 7 } })).id;
  ids.lead = (await db.lead.create({ data: { tenantId: ids.agency!, branchId: ids.head!, kind: "contact_agent", name: "Ram Karki", email: "ram@buyer.test", phone: "9803333333" } })).id;
});
afterAll(async () => { await app.close(); });

describe("who can make agreements", () => {
  it("needs agreements.manage and a plan with agreements", async () => {
    expect((await call("agent", "GET", "/agreements")).statusCode).toBe(403);
    expect((await call("manager", "GET", "/agreements")).statusCode).toBe(200);
    const free = await call("free", "GET", "/agreements", undefined, ids.freeBiz);
    expect(free.statusCode).toBe(403);
    expect(free.json().message).toMatch(/Business and Pro/);
  });
  it("lists the five templates with their English and Nepali wording", async () => {
    const t = (await call("owner", "GET", "/agreements")).json().data.templates;
    expect(t.map((x: { kind: string }) => x.kind)).toEqual(["rent", "sale", "management", "booking", "blank"]);
    for (const x of t) { expect(x.bodyEn).not.toMatch(/[\u0900-\u097F]/); expect(x.bodyNe).toMatch(/[\u0900-\u097F]/); }
  });
});

describe("a rent agreement from a lease", () => {
  it("fills the parties and terms from the lease", async () => {
    const r = await call("manager", "POST", "/agreements", { kind: "rent", lang: "both", leaseId: ids.lease });
    expect(r.statusCode).toBe(200);
    ids.ag = r.json().data.id;
    const a = (await call("manager", "GET", `/agreements/${ids.ag}`)).json().data;
    expect(a).toMatchObject({ ref: "AG-0001", kind: "rent", lang: "both", status: "draft", branchId: ids.head, leaseId: ids.lease });
    expect(a.values).toMatchObject({ rent: 25000, deposit: 50000, due_day: 7, start: "2026-12-01", end: "2027-11-30" });
    expect(a.signers.map((s: { role: string; name: string }) => [s.role, s.name])).toEqual([["p1", "Hari Shrestha"], ["p2", "Sita Sharma"]]);
    expect(a.texts.en).toContain("Rs. 25,000");
    expect(a.texts.ne).toContain("रु. २५,०००");
    expect(a.texts.ne).toContain("ई.सं. २०२६ डिसेम्बर १");
    expect(a.texts.ne).not.toMatch(/Rs\.|[0-9]{2}/); // the Nepali copy keeps to Nepali
    expect(a.missing.ne).toContain("घरधनीको नाम");
    expect(a.problem).toMatch(/^Fill in:/);
  });

  it("saves the draft and checks values (422)", async () => {
    const a = (await call("manager", "GET", `/agreements/${ids.ag}`)).json().data;
    expect((await call("manager", "PUT", `/agreements/${ids.ag}`, edit(a, { values: { ...a.values, rent: "lots" } }))).statusCode).toBe(422);
    expect((await call("manager", "PUT", `/agreements/${ids.ag}`, edit(a, { lang: "fr" }))).statusCode).toBe(422);
    const signers = [
      { ...a.signers[0], nameNe: "हरि श्रेष्ठ", address: "Baneshwor, Kathmandu", addressNe: "बानेश्वर, काठमाडौं", idNo: "27-01-74-01234" },
      { ...a.signers[1], nameNe: "सीता शर्मा", address: "Lalitpur", addressNe: "ललितपुर", idNo: "12-02-75-04567" },
      { role: "witness", name: "Gita Rai", email: "gita@witness.test" },
    ];
    const values = { ...a.values, property: { en: "Flat 2, Shrestha Niwas", ne: "श्रेष्ठ निवासको फ्ल्याट २" }, address: { en: "Baneshwor, Kathmandu", ne: "बानेश्वर, काठमाडौं" } };
    const r = await call("manager", "PUT", `/agreements/${ids.ag}`, edit(a, { signers, values }));
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.missing).toEqual({});
    expect(d.problem).toBeNull();
    expect(d.texts.ne).toContain("ना.प्र.नं. २७-०१-७४-०१२३४ भएका हरि श्रेष्ठ");
    expect(d.signers).toHaveLength(3);
  });

  it("won't send with a shared email, then sends and freezes it", async () => {
    const a = (await call("manager", "GET", `/agreements/${ids.ag}`)).json().data;
    const same = a.signers.map((s: { role: string }) => (s.role === "witness" ? { ...s, email: "sita@renter.test" } : s));
    await call("manager", "PUT", `/agreements/${ids.ag}`, edit(a, { signers: same }));
    const bad = await call("manager", "POST", `/agreements/${ids.ag}/send`);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/own email/);
    await call("manager", "PUT", `/agreements/${ids.ag}`, edit(a));
    const r = await call("manager", "POST", `/agreements/${ids.ag}/send`);
    expect(r.statusCode).toBe(200);
    const db = app.db!;
    const row = await db.agreement.findUniqueOrThrow({ where: { id: ids.ag }, include: { signers: true } });
    expect(row.status).toBe("sent");
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.textNe).toContain("सीता शर्मा");
    expect(row.signers.every((s) => s.tokenHash && s.tokenHash.length === 64)).toBe(true);
    const mails = await db.outboundEmail.findMany({ where: { subject: { contains: "Please sign" } } });
    expect(mails.map((m) => m.to).sort()).toEqual(["gita@witness.test", "hari@owner.test", "sita@renter.test"]);
    expect(mails[0]!.text).toMatch(/https:\/\/sheetal\.test\/sign\/[A-Za-z0-9_-]{30,}/);
    expect(mails[0]!.text).toContain("नमस्ते");
    // Sent agreements don't change.
    expect((await call("manager", "PUT", `/agreements/${ids.ag}`, edit(a))).statusCode).toBe(400);
    expect((await call("manager", "POST", `/agreements/${ids.ag}/send`)).statusCode).toBe(400);
    expect((await call("manager", "DELETE", `/agreements/${ids.ag}`)).statusCode).toBe(400);
  });

  it("sends a new link that replaces the old one", async () => {
    const db = app.db!;
    const s = await db.agreementSigner.findFirstOrThrow({ where: { agreementId: ids.ag, role: "p2" } });
    const r = await call("manager", "POST", `/agreements/${ids.ag}/signers/${s.id}/remind`);
    expect(r.statusCode).toBe(200);
    expect((await db.agreementSigner.findUniqueOrThrow({ where: { id: s.id } })).tokenHash).not.toBe(s.tokenHash);
  });

  it("cancels, emails the people, and copies into a new draft", async () => {
    const r = await call("owner", "POST", `/agreements/${ids.ag}/cancel`, { note: "Wrong flat" });
    expect(r.statusCode).toBe(200);
    expect(await app.db!.outboundEmail.count({ where: { subject: { startsWith: "Cancelled:" } } })).toBe(3);
    expect((await call("owner", "POST", `/agreements/${ids.ag}/cancel`)).statusCode).toBe(400);
    const c = await call("owner", "POST", `/agreements/${ids.ag}/copy`);
    expect(c.statusCode).toBe(200);
    const d = (await call("owner", "GET", `/agreements/${c.json().data.id}`)).json().data;
    expect(d).toMatchObject({ ref: "AG-0002", status: "draft", hash: null });
    expect(d.signers).toHaveLength(3);
    expect((await call("owner", "DELETE", `/agreements/${d.id}`)).statusCode).toBe(200);
  });
});

describe("other templates", () => {
  it("makes a sale agreement from a lead, with the business's person where needed", async () => {
    const r = await call("owner", "POST", "/agreements", { kind: "sale", lang: "en", leadId: ids.lead });
    const a = (await call("owner", "GET", `/agreements/${r.json().data.id}`)).json().data;
    expect(a.signers.map((s: { role: string; name: string }) => [s.role, s.name])).toEqual([["p2", "Ram Karki"]]);
    expect(a.texts.ne).toBeUndefined();
    const m = await call("owner", "POST", "/agreements", { kind: "management", lang: "en", leaseId: ids.lease });
    const b = (await call("owner", "GET", `/agreements/${m.json().data.id}`)).json().data;
    expect(b.signers.find((s: { role: string }) => s.role === "p2")).toMatchObject({ name: "owner", email: "owner@ag.test" });
    expect(b.values.fee_pct).toBe(8);
  });

  it("checks the sale numbers before sending", async () => {
    const r = await call("owner", "POST", "/agreements", { kind: "sale", lang: "en", branchId: ids.head });
    const a = (await call("owner", "GET", `/agreements/${r.json().data.id}`)).json().data;
    const signers = [{ role: "p1", name: "A Seller", email: "s@x.test", address: "Kathmandu", idNo: "1" }, { role: "p2", name: "A Buyer", email: "b@x.test", address: "Pokhara", idNo: "2" }];
    const values = { ...a.values, property: { en: "Land", ne: "" }, address: { en: "Dhapasi", ne: "" }, price: 1_000_000, token: 2_000_000, deadline: "2027-01-31" };
    const d = (await call("owner", "PUT", `/agreements/${a.id}`, edit(a, { signers, values }))).json().data;
    expect(d.problem).toBe("The token can't be more than the price.");
    const ok = (await call("owner", "PUT", `/agreements/${a.id}`, edit(a, { signers, values: { ...values, token: 100_000 } }))).json().data;
    expect(ok.problem).toBeNull();
    expect(ok.texts.en).toContain("remaining Rs. 9,00,000");
  });
});

describe("branches", () => {
  it("keeps branch people to their branches and stops a branch with agreements being removed", async () => {
    expect((await call("pokhara", "GET", "/agreements")).json().data.rows).toEqual([]);
    expect((await call("pokhara", "GET", `/agreements/${ids.ag}`)).statusCode).toBe(404);
    expect((await call("pokhara", "POST", "/agreements", { kind: "rent", leaseId: ids.lease })).statusCode).toBe(404);
    const r = await call("pokhara", "POST", "/agreements", { kind: "blank", lang: "en" });
    expect(r.statusCode).toBe(200);
    const del = await call("owner", "DELETE", `/branches/${ids.pokharaBranch}`);
    expect(del.statusCode).toBe(400);
    expect(del.json().message).toMatch(/agreement/);
  });
});
