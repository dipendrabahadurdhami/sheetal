import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { Vault } from "@sheetal/platform/auth/vault";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-forms-"));
const ids: Record<string, string> = {};
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// Each call from its own address, so the 5-a-minute limit doesn't get in the way (one test checks it).
const call = (method: "GET" | "POST", url: string, body?: object, ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) =>
  app.inject({ method, url: `/v1${url}`, payload: body, remoteAddress: ip });
const F = (id: string, type: string, label: string, extra: object = {}) => ({ id, type, label, required: false, ph: "", help: "", half: false, min: "", max: "", opts: [], amount: 0, ...extra });
const REQ_FIELDS = [
  F("want", "single", "I want to", { required: true, opts: ["Buy", "Rent", "Invest"] }),
  F("type", "multi", "Property type", { opts: ["House", "Land", "Flat", "Shop"] }),
  F("loc", "location", "Preferred area", { required: true }),
  F("budget", "money", "Max budget"),
  F("name", "short", "Full name", { required: true }),
  F("phone", "phone", "Phone", { required: true }),
  F("doc", "file", "Citizenship copy"),
];
const good = { want: "Buy", type: ["House"], loc: { district: "Kathmandu", area: "Budhanilkantha" }, budget: "20000000", name: "Sita Sharma", phone: "980-1234567" };
const captchaOk = "good";

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "website"), {
    fetch: (async (_url: string, init: { body: URLSearchParams }) => new Response(JSON.stringify({ success: init.body.get("response") === captchaOk }), { headers: { "content-type": "application/json" } })) as never,
  });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, listings, leads, forms, form_responses RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await db.plan.create({ data: { id: "agency-tiny", type: "agency", name: "Tiny", price: 500, limits: { formResponses: 1 }, features: {}, sort: 9 } });
  const owner = await db.user.create({ data: { email: "owner@everest.test", userName: "owner", emailVerifiedAt: new Date() } });
  const agent = await db.user.create({ data: { email: "agent@everest.test", userName: "agent", emailVerifiedAt: new Date() } });
  ids.owner = owner.id; ids.agent = agent.id;
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  await db.tenant.update({ where: { id: ids.agency }, data: { email: "office@everest.test", status: "active" } });
  ids.branch = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency } })).id;
  const agentRole = await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "agent" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: agent.id, roleId: agentRole.id, status: "active" } });
  const listing = (code: string, over: object) => db.listing.create({ data: { code, slug: code.toLowerCase(), tenantId: ids.agency, branchId: ids.branch, kind: "sell", purpose: "sale", category: "House", title: `Home ${code}`, status: "published", district: "Kathmandu", price: BigInt(15_000_000), publishedAt: new Date(), ...over } });
  await listing("ER-0001", {});
  await listing("ER-0002", { price: BigInt(50_000_000) }); // over budget
  await listing("ER-0003", { district: "Lalitpur" });
  await listing("ER-0004", { purpose: "rent", kind: "rentout", price: BigInt(40_000) });
  await listing("ER-0005", { category: "Land" });
  await db.form.create({ data: { tenantId: ids.agency!, branchId: ids.branch, slug: "find-a-home", title: "Find a home", dest: "requirements", status: "live", fields: REQ_FIELDS, thanks: "Thanks, we'll call you.", assigneeId: agent.id, style: { accent: "#1F5FAD" } } });
  await db.form.create({ data: { tenantId: ids.agency!, branchId: ids.branch, slug: "draft-form", title: "Draft", status: "draft", fields: REQ_FIELDS } });
  const tiny = await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: "Tiny Office", type: "agency", planId: "agency-tiny" }));
  await db.tenant.update({ where: { id: tiny.id }, data: { status: "active" } });
  await db.form.create({ data: { tenantId: tiny.id, slug: "tiny", title: "Tiny", status: "live", fields: [F("p", "phone", "Phone", { required: true })] } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("showing a form", () => {
  it("shows a live form and hides drafts", async () => {
    const r = await call("GET", "/forms/find-a-home");
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ title: "Find a home", thanks: "Thanks, we'll call you.", business: { name: "Everest Realty" }, captcha: null, closed: false, pay: null });
    expect(r.json().data.fields).toHaveLength(7);
    expect(JSON.stringify(r.json().data)).not.toContain(ids.agent!);
    expect((await call("GET", "/forms/draft-form")).statusCode).toBe(404);
    expect((await call("GET", "/forms/nope")).statusCode).toBe(404);
  });
});

describe("answering a form", () => {
  it("checks answers against the form's own fields (422 with the question's id)", async () => {
    const miss = await call("POST", "/forms/find-a-home", { answers: { want: "Buy" } });
    expect(miss.statusCode).toBe(422);
    expect(Object.keys(miss.json().errors).sort()).toEqual(["loc", "name", "phone"]);
    const bad = await call("POST", "/forms/find-a-home", { answers: { ...good, want: "Steal", phone: "12", budget: "lots" } });
    expect(bad.statusCode).toBe(422);
    expect(Object.keys(bad.json().errors).sort()).toEqual(["budget", "phone", "want"]);
    const notPic = await call("POST", "/forms/find-a-home", { answers: { ...good, doc: { name: "x.exe", data: Buffer.from("MZ not a document at all").toString("base64") } } });
    expect(notPic.statusCode).toBe(400);
    expect(await app.db!.lead.count()).toBe(0);
  });

  it("quietly drops answers that fill the hidden spam field", async () => {
    const r = await call("POST", "/forms/find-a-home", { answers: good, website: "http://spam.example" });
    expect(r.statusCode).toBe(200);
    expect(await app.db!.formResponse.count()).toBe(0);
  });

  it("makes an Inbox lead for the assignee, with the listings that match, a notification and an email", async () => {
    const r = await call("POST", "/forms/find-a-home", { answers: { ...good, doc: { name: "citizenship.png", data: PNG }, extra: "ignored" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().message).toBe("Thanks, we'll call you.");
    const db = app.db!;
    const resp = await db.formResponse.findFirstOrThrow();
    expect(resp).toMatchObject({ tenantId: ids.agency, name: "Sita Sharma", phone: "9801234567", payAmount: null });
    const doc = (resp.answers as { id: string; value: { file?: string; name?: string } }[]).find((a) => a.id === "doc")!;
    expect(doc.value.name).toBe("citizenship.png");
    expect(doc.value.file).toMatch(/^[A-Za-z0-9_-]{16}\.png$/);
    expect(JSON.stringify(resp.answers)).not.toContain("ignored");
    const lead = await db.lead.findUniqueOrThrow({ where: { id: resp.leadId! } });
    expect(lead).toMatchObject({ tenantId: ids.agency, branchId: ids.branch, kind: "form", assigneeId: ids.agent, name: "Sita Sharma", tags: ["Find a home", "Requirement"] });
    expect(lead.message).toContain("Preferred area: Budhanilkantha, Kathmandu");
    const d = lead.details as { formId: string; responseId: string; matches: { code: string }[] };
    expect(d.responseId).toBe(resp.id);
    expect(d.matches.map((m) => m.code)).toEqual(["ER-0001"]);
    const notes = await db.notification.findMany({ where: { tenantId: ids.agency } });
    expect(notes.map((n) => n.userId).sort()).toEqual([ids.agent, ids.owner].sort());
    expect(notes[0]!.title).toBe("New response to Find a home");
    const mails = await db.outboundEmail.findMany({ where: { subject: { contains: "Find a home" } } });
    expect(mails.map((m) => m.to).sort()).toEqual(["agent@everest.test", "office@everest.test"]);
    expect(mails[0]!.text).toContain("ER-0001");
  });

  it("takes 5 answers a minute from one address", async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await call("POST", "/forms/find-a-home", { answers: { want: "Buy" } }, "10.250.0.1")).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 422)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it("asks for the robot check once Sheetal saves its keys", async () => {
    const db = app.db!;
    await db.appSetting.create({ data: { key: "captcha", value: { siteKey: "0x4AAAAsite", secret: new Vault(undefined, false).seal("0x4AAAAsecret") } } });
    expect((await call("GET", "/forms/find-a-home")).json().data.captcha).toBe("0x4AAAAsite");
    expect((await call("POST", "/forms/find-a-home", { answers: good })).statusCode).toBe(400);
    expect((await call("POST", "/forms/find-a-home", { answers: good, captcha: "bad" })).statusCode).toBe(400);
    expect((await call("POST", "/forms/find-a-home", { answers: good, captcha: "good" })).statusCode).toBe(200);
    await db.appSetting.delete({ where: { key: "captcha" } });
  });

  it("closes the form for the month once the plan's responses are used", async () => {
    expect((await call("POST", "/forms/tiny", { answers: { p: "9800000001" } })).statusCode).toBe(200);
    const r = await call("POST", "/forms/tiny", { answers: { p: "9800000002" } });
    expect(r.statusCode).toBe(403);
    expect((await call("GET", "/forms/tiny")).json().data.closed).toBe(true);
  });
});
