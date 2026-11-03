import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-content-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const ip = () => `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const call = (who: string | null, method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: who ? { authorization: `Bearer ${tok[who]}` } : {}, remoteAddress: ip() });

function form(fields: Record<string, string>, files: Record<string, [string, string, Buffer]>) {
  const b = `----sheetal${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const [k, [name, type, data]] of Object.entries(files)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), data, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
}
const multipart = (url: string, fields: Record<string, string>, files: Record<string, [string, string, Buffer]> = {}, who?: string) => {
  const f = form(fields, files);
  return app.inject({ method: "POST", url: `/v1${url}`, payload: f.payload, headers: { ...f.headers, ...(who ? { authorization: `Bearer ${tok[who]}` } : {}) }, remoteAddress: ip() });
};

async function person(key: string, email: string) {
  const u = await app.db!.user.create({ data: { email, userName: key, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "website"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, leads, notifications, blog_categories, blog_posts, job_posts, app_settings, outbound_emails RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("buyer", "buyer@sheetal.test");
  await person("agent", "agent@everest.test");
  await person("other", "other@sheetal.test");
  ids.tenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.agent!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  const l = await db.listing.create({ data: { code: "SP-0001", slug: "house-1", tenantId: ids.tenant, userId: ids.agent, purpose: "sale", category: "House", title: "House in Dhapasi", status: "published", publishedAt: new Date() } });
  ids.listing = String(l.id);
  const cat = await db.blogCategory.create({ data: { name: "Buying guides", slug: "buying-guides" } });
  await db.blogPost.create({ data: { categoryId: cat.id, title: "How to check a lalpurja", slug: "check-lalpurja", content: "<p>Always check the lalpurja at the land revenue office. ".repeat(20) + "</p>", status: "published", publishedAt: new Date(Date.now() - 864e5), tags: ["land"] } });
  await db.blogPost.create({ data: { categoryId: cat.id, title: "Draft post", slug: "draft-post", content: "<p>Not yet.</p>", status: "draft" } });
  await db.blogPost.create({ data: { title: "Scheduled post", slug: "scheduled", content: "<p>Later.</p>", status: "published", publishedAt: new Date(Date.now() + 864e5) } });
  await db.jobPost.create({ data: { title: "Sales agent", slug: "sales-agent", description: "<p>Sell homes.</p>", status: "open", salaryMin: 30000, salaryMax: 45000, showSalary: true } });
  await db.jobPost.create({ data: { title: "Closed job", slug: "closed-job", description: "<p>No.</p>", status: "closed" } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("blog", () => {
  it("shows only published posts that are due, with categories and paging", async () => {
    const r = (await call(null, "GET", "/blog")).json();
    expect(r.data.map((p: { slug: string }) => p.slug)).toEqual(["check-lalpurja"]);
    expect(r.data[0]).toMatchObject({ category: { slug: "buying-guides" }, read_time: expect.any(Number) });
    expect(r.meta.total).toBe(1);
    expect((await call(null, "GET", "/blog/categories")).json().data).toEqual([expect.objectContaining({ slug: "buying-guides", posts_count: 1 })]);
    expect((await call(null, "GET", "/blog/draft-post")).statusCode).toBe(404);
    expect((await call(null, "GET", "/blog/scheduled")).statusCode).toBe(404);
  });

  it("holds comments for approval and never shows commenters' emails", async () => {
    const post = (await call(null, "GET", "/blog/check-lalpurja")).json().data;
    expect((await call(null, "POST", `/blog/${post.id}/comment`, { name: "Sita", email: "sita@x.test", comment: "Very useful, thanks!" })).statusCode).toBe(200);
    expect((await call(null, "GET", "/blog/check-lalpurja")).json().data.comments).toEqual([]);
    await app.db!.blogComment.updateMany({ data: { status: "approved" } });
    const after = (await call(null, "GET", "/blog/check-lalpurja")).json().data;
    expect(after.comments).toEqual([expect.objectContaining({ name: "Sita", comment: "Very useful, thanks!" })]);
    expect(JSON.stringify(after)).not.toContain("sita@x.test");
  });
});

describe("careers", () => {
  it("lists open jobs and takes applications with a real CV only", async () => {
    expect((await call(null, "GET", "/jobs")).json().data).toEqual([expect.objectContaining({ slug: "sales-agent", salary: "Rs. 30,000 – 45,000 a month" })]);
    expect((await call(null, "GET", "/jobs/closed-job")).statusCode).toBe(404);
    const bad = await multipart("/jobs/sales-agent/apply", { name: "Ram", email: "ram@x.test" }, { cv: ["cv.pdf", "application/pdf", Buffer.from("not a pdf at all......")] });
    expect(bad.statusCode).toBe(400);
    const ok = await multipart("/jobs/sales-agent/apply", { name: "Ram", email: "Ram@X.test", phone: "9800000000" }, { cv: ["cv.pdf", "application/pdf", PDF] });
    expect(ok.statusCode).toBe(200);
    const a = await app.db!.jobApplication.findFirstOrThrow();
    expect(a).toMatchObject({ email: "ram@x.test", cvFile: expect.stringMatching(/\.pdf$/) });
    // CVs are private: not reachable as /media.
    expect((await app.inject({ method: "GET", url: `/media/private/cv/${a.cvFile}` })).statusCode).toBe(404);
  });
});

describe("requirement board", () => {
  it("puts a requirement for Sheetal on the board without contact details", async () => {
    const r = await multipart("/requirement-form", { name: "Gita Sharma", phone: "9811111111", email: "gita@buyer.test", property_type: "House", prefered_location: "Budhanilkantha", maximum_budget: "40000000", description: "Call me on 9811111111 or gita@buyer.test" }, {}, "buyer");
    expect(r.json().message).toContain("REQ-0001");
    const list = (await call(null, "GET", "/property-demand-list")).json().data;
    expect(list).toEqual([expect.objectContaining({ id: 1, name: "Gita", property_type: "House", prefered_location: "Budhanilkantha" })]);
    expect(JSON.stringify(list)).not.toMatch(/9811111111|gita@buyer\.test|Sharma/);
  });

  it("lets agents offer their own live listings once; the buyer is emailed and notified", async () => {
    expect((await call("other", "POST", "/demand-match", { requirement_form_id: 1, property_id: Number(ids.listing) })).statusCode).toBe(403);
    expect((await call("agent", "POST", "/demand-match", { requirement_form_id: 1, property_id: Number(ids.listing), message: "Great fit, call 9800000000" })).statusCode).toBe(200);
    expect((await call("agent", "POST", "/demand-match", { requirement_form_id: 1, property_id: Number(ids.listing) })).statusCode).toBe(400);
    expect((await call(null, "GET", "/demand-matches-by-requirements?requirement_form_ids=1,2")).json().data).toEqual([{ requirement_form_id: 1, matches_count: 1 }]);
    const mail = await app.db!.outboundEmail.findFirstOrThrow({ where: { to: "gita@buyer.test" } });
    expect(mail.text).toContain("House in Dhapasi");
    expect(mail.text).not.toContain("9800000000");
    const n = (await call("buyer", "GET", "/agent-notifications")).json();
    expect(n).toMatchObject({ unread_count: 1, data: [expect.objectContaining({ type: "demand_match", link: "/property/house-1" })] });
    await call("buyer", "POST", "/agent-notifications/read-all");
    expect((await call("buyer", "GET", "/agent-notifications")).json().unread_count).toBe(0);
  });

  it("with the fee on, needs a payment proof and keeps it off the board until confirmed", async () => {
    await app.db!.appSetting.create({ data: { key: "requirement_fee", value: { enabled: true, amount: 500, note: "eSewa 9800000000" } } });
    expect((await call(null, "GET", "/requirement-fee/settings-public")).json().data).toMatchObject({ enabled: true, amount: 500 });
    const fields = { name: "Hari", phone: "9822222222", property_type: "Land", prefered_location: "Lalitpur" };
    expect((await multipart("/requirement-form", fields)).statusCode).toBe(400);
    const r = await multipart("/requirement-form", { ...fields, payment_reference: "ESW123" }, { payment_proof: ["pay.png", "image/png", PNG] });
    expect(r.json().message).toContain("once Sheetal confirms");
    const lead = await app.db!.lead.findFirstOrThrow({ where: { name: "Hari" } });
    expect(lead).toMatchObject({ public: false, feeStatus: "pending", feeAmount: 500, feeRef: "ESW123" });
    expect((await call(null, "GET", "/property-demand-list")).json().data.map((d: { name: string }) => d.name)).toEqual(["Gita"]);
  });

  it("tells the business's team about a new enquiry", async () => {
    await call(null, "POST", "/contact-agent", { name: "Bikash", phone: "9833333333", property_id: Number(ids.listing), message_description: "Is it available?" });
    const n = await app.db!.notification.findFirstOrThrow({ where: { userId: ids.agent, type: "lead" } });
    expect(n).toMatchObject({ title: "New enquiry from Bikash", link: "/business/inbox" });
  });
});
