import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
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
const call = (who: string, method: "GET" | "POST" | "PATCH" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });

async function person(key: string, email: string, platformRole: string | null = null) {
  const u = await app.db!.user.create({ data: { email, userName: key, platformRole, passwordHash: "x" } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, outbound_emails, audit_logs, upgrade_requests RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("boss", "admin@sheetal.test", "super_admin");
  await person("ops", "ops@sheetal.test", "operations");
  await person("help", "help@sheetal.test", "support");
  await person("owner", "owner@everest.test");
  ids.tenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", city: "Lalitpur" }))).id;
  await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Inn", type: "hotel", planId: "hotel-business" }));
});
afterAll(async () => { await app.close(); });

describe("staff only", () => {
  it("keeps businesses out", async () => {
    expect((await call("owner", "GET", "/admin/tenants")).statusCode).toBe(403);
    expect((await call("ops", "GET", "/admin/me")).json().data).toMatchObject({ role: "operations" });
  });
});

describe("businesses", () => {
  it("lists, searches and filters", async () => {
    expect((await call("ops", "GET", "/admin/tenants")).json().meta.total).toBe(2);
    expect((await call("ops", "GET", "/admin/tenants?q=lalit")).json().data.map((t: { name: string }) => t.name)).toEqual(["Everest Realty"]);
    expect((await call("ops", "GET", "/admin/tenants?type=hotel")).json().data[0]).toMatchObject({ name: "Lakeside Inn", plan: { name: "Business" }, members: 1 });
  });

  it("shows one business with its team", async () => {
    const d = (await call("help", "GET", `/admin/tenants/${ids.tenant}`)).json().data;
    expect(d).toMatchObject({ name: "Everest Realty", plan: { id: "agency-starter" }, members: [expect.objectContaining({ email: "owner@everest.test", role: "owner" })] });
  });

  it("suspends only with the right staff role, and records it", async () => {
    expect((await call("help", "PATCH", `/admin/tenants/${ids.tenant}`, { status: "suspended" })).statusCode).toBe(403);
    expect((await call("ops", "PATCH", `/admin/tenants/${ids.tenant}`, { status: "suspended" })).statusCode).toBe(200);
    expect((await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.tenant } })).status).toBe("suspended");
    const log = (await call("ops", "GET", `/admin/audit?tenantId=${ids.tenant}`)).json().data;
    expect(log[0]).toMatchObject({ action: "admin.tenant_updated", actor: { email: "ops@sheetal.test" } });
    await call("ops", "PATCH", `/admin/tenants/${ids.tenant}`, { status: "active" });
  });

  it("leaves auto-renew to the super admin, and checks plans fit the business type", async () => {
    expect((await call("ops", "PATCH", `/admin/tenants/${ids.tenant}`, { autoRenew: true })).statusCode).toBe(403);
    expect((await call("boss", "PATCH", `/admin/tenants/${ids.tenant}`, { autoRenew: true })).statusCode).toBe(200);
    expect((await call("boss", "PATCH", `/admin/tenants/${ids.tenant}`, { planId: "hotel-pro" })).statusCode).toBe(400);
  });
});

describe("upgrade requests", () => {
  it("lists them and, once paid, moves the business to the new plan", async () => {
    const r = await app.db!.upgradeRequest.create({ data: { tenantId: ids.tenant!, userId: ids.owner!, planId: "agency-pro", months: 12 } });
    const list = (await call("ops", "GET", "/admin/upgrades")).json().data;
    expect(list[0]).toMatchObject({ plan: { name: "Pro" }, tenant: { name: "Everest Realty" }, user: { email: "owner@everest.test" } });
    expect((await call("ops", "PATCH", `/admin/upgrades/${r.id}`, { status: "done" })).statusCode).toBe(403); // operations doesn't manage plans
    expect((await call("boss", "PATCH", `/admin/upgrades/${r.id}`, { status: "done" })).statusCode).toBe(200);
    const t = await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.tenant } });
    expect(t).toMatchObject({ planId: "agency-pro", period: 12, status: "active" });
    expect(t.renewsAt!.getTime()).toBeGreaterThan(Date.now() + 360 * 864e5);
  });
});

describe("adding a business", () => {
  it("sets it up for a new owner with a set-password link, for staff who manage businesses", async () => {
    const body = { name: "Pokhara Homes", type: "agency", city: "Pokhara", owner: "Maya Gurung", email: "Maya@Pokhara.test", phone: "9800000002" };
    expect((await call("help", "POST", "/admin/tenants", body)).statusCode).toBe(403);
    const res = await call("ops", "POST", "/admin/tenants", body);
    expect(res.statusCode).toBe(200);
    const t = await app.db!.tenant.findUniqueOrThrow({ where: { id: res.json().data.id }, include: { memberships: { include: { user: true, role: true } } } });
    expect(t).toMatchObject({ name: "Pokhara Homes", planId: "agency-starter", city: "Pokhara" });
    expect(t.memberships[0]).toMatchObject({ role: { key: "owner" }, user: { email: "maya@pokhara.test", userName: "Maya Gurung" } });
    expect((await app.db!.outboundEmail.findFirstOrThrow({ where: { to: "maya@pokhara.test" } })).text).toContain("/reset-password/");
    const list = (await call("ops", "GET", "/admin/tenants?q=pokhara")).json().data;
    expect(list[0]).toMatchObject({ owner: { name: "Maya Gurung", email: "maya@pokhara.test" }, members: 1 });
  });
});

describe("plans", () => {
  it("lists plans with the yearly price and how many businesses are on each", async () => {
    const d = (await call("help", "GET", "/admin/plans")).json().data;
    expect(d.find((p: { id: string }) => p.id === "agency-pro")).toMatchObject({ price: 3000, yearly: Math.round(3000 * 12 * 0.61) });
    expect(d.find((p: { id: string }) => p.id === "hotel-business").businesses).toBe(1);
  });

  it("lets plan managers change prices, never making Starter paid or hidden", async () => {
    const edit = { name: "Business", price: 1800, limits: { listings: 200, seats: 10, featured: 8 }, features: { agreements: true }, active: true };
    expect((await call("ops", "PATCH", "/admin/plans/agency-business", edit)).statusCode).toBe(403);
    expect((await call("boss", "PATCH", "/admin/plans/agency-business", edit)).statusCode).toBe(200);
    expect(await app.db!.plan.findUniqueOrThrow({ where: { id: "agency-business" } })).toMatchObject({ price: 1800, limits: { listings: 200 } });
    expect((await call("boss", "PATCH", "/admin/plans/agency-starter", { ...edit, name: "Starter", price: 100 })).statusCode).toBe(400);
    expect((await call("boss", "PATCH", "/admin/plans/agency-starter", { ...edit, name: "Starter", price: 0, active: false })).statusCode).toBe(400);
    const add = await call("boss", "POST", "/admin/plans", { ...edit, type: "host", name: "Host Plus", price: 2200 });
    expect(add.json().data.id).toBe("host-host-plus");
    expect((await call("boss", "POST", "/admin/plans", { ...edit, type: "host", name: "Host Plus", price: 2200 })).statusCode).toBe(400);
  });
});

describe("listing review", () => {
  it("queues pending listings oldest first, for moderators only", async () => {
    const db = app.db!;
    await db.$executeRawUnsafe(`TRUNCATE listings RESTART IDENTITY CASCADE`);
    const mk = (code: string, mins: number, p: object = {}) => db.listing.create({ data: {
      code, slug: code.toLowerCase(), tenantId: ids.tenant, userId: ids.owner, purpose: "sale", category: "House", title: `House ${code}`, status: "pending",
      submittedAt: new Date(Date.now() - mins * 60e3), private: { owner: "Ram Thapa", owner_phone: "9800000001" }, ...p,
    } });
    await mk("SP-0001", 5);
    await mk("SP-0002", 60);
    await mk("SP-0003", 0, { status: "published" });
    expect((await call("help", "GET", "/admin/listings")).statusCode).toBe(403);
    const r = (await call("ops", "GET", "/admin/listings")).json();
    expect(r.data.map((l: { code: string }) => l.code)).toEqual(["SP-0002", "SP-0001"]);
    expect(r.data[0]).toMatchObject({ tenant: { name: "Everest Realty" }, poster: { email: "owner@everest.test" } });
    expect(r.meta.waiting).toBe(2);
    const d = (await call("ops", "GET", `/admin/listings/${r.data[0].id}`)).json().data;
    expect(d).toMatchObject({ code: "SP-0002", owner: { name: "Ram Thapa", phone: "9800000001" } });
  });

  it("approves into the website, or sends back with a note; both are emailed", async () => {
    await app.db!.tenant.update({ where: { id: ids.tenant }, data: { email: "hello@everest.test" } });
    expect((await call("ops", "POST", "/admin/listings/1/review", { decision: "reject" })).statusCode).toBe(400);
    expect((await call("ops", "POST", "/admin/listings/1/review", { decision: "reject", note: "Add a photo of the road." })).statusCode).toBe(200);
    expect(await app.db!.listing.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ status: "rejected", reviewNote: "Add a photo of the road.", reviewedBy: ids.ops });
    const mails = await app.db!.outboundEmail.findMany({ where: { subject: "Changes needed: House SP-0001" } });
    expect(mails.map((m) => m.to).sort()).toEqual(["hello@everest.test", "owner@everest.test"]);

    expect((await call("ops", "POST", "/admin/listings/2/review", { decision: "approve" })).json().message).toContain("live");
    const l = await app.db!.listing.findUniqueOrThrow({ where: { id: 2 } });
    expect(l.status).toBe("published");
    expect(l.publishedAt).not.toBeNull();
    expect(l.checkDueAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 864e5);
    // Decided already.
    expect((await call("ops", "POST", "/admin/listings/2/review", { decision: "reject", note: "x" })).statusCode).toBe(400);
  });
});

describe("content", () => {
  it("cleans blog HTML; only publishers make posts live", async () => {
    await app.db!.$executeRawUnsafe(`TRUNCATE blog_categories, blog_posts, job_posts, notifications RESTART IDENTITY CASCADE`);
    await person("editor", "editor@sheetal.test", "content_editor");
    const body = { title: "Buying land in Kathmandu", content: `<p onclick="x()">${"Check the lalpurja and the road. ".repeat(5)}</p><script>alert(1)</script>`, status: "published" };
    expect((await call("help", "POST", "/admin/blog/posts", body)).statusCode).toBe(403);
    const r = await call("editor", "POST", "/admin/blog/posts", body);
    expect(r.statusCode).toBe(200); // content editors have content.publish
    const p = await app.db!.blogPost.findUniqueOrThrow({ where: { id: r.json().data.id } });
    expect(p).toMatchObject({ slug: "buying-land-in-kathmandu", status: "published" });
    expect(p.content).not.toMatch(/script|onclick/);
    expect(p.publishedAt).not.toBeNull();
    const again = await call("editor", "POST", "/admin/blog/posts", { ...body, status: "draft" });
    expect((await app.db!.blogPost.findUniqueOrThrow({ where: { id: again.json().data.id } })).slug).toBe("buying-land-in-kathmandu-2");
  });

  it("posts jobs and keeps CVs behind staff sign-in", async () => {
    const j = await call("editor", "POST", "/admin/jobs", { title: "Field agent", description: "<p>Show homes.</p>", status: "open" });
    expect(j.statusCode).toBe(200);
    expect((await call("editor", "GET", "/admin/jobs")).json().data[0]).toMatchObject({ slug: "field-agent", applications: 0 });
    expect((await call("owner", "GET", "/admin/jobs")).statusCode).toBe(403);
  });

  it("confirms a requirement fee, putting it on the board and telling the buyer", async () => {
    const l = await app.db!.lead.create({ data: { kind: "requirement", name: "Hari", email: "hari@buyer.test", userId: ids.owner, feeStatus: "pending", feeAmount: 500, public: false } });
    expect((await call("ops", "GET", "/admin/requirements")).json()).toMatchObject({ meta: { waiting: 1 }, data: [expect.objectContaining({ id: l.id, code: expect.stringMatching(/^REQ-/) })] });
    expect((await call("ops", "PATCH", `/admin/requirements/${l.id}`, { fee: "rejected" })).statusCode).toBe(400);
    expect((await call("ops", "PATCH", `/admin/requirements/${l.id}`, { fee: "confirmed" })).statusCode).toBe(200);
    expect(await app.db!.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ public: true, feeStatus: "confirmed" });
    expect((await app.db!.outboundEmail.findFirstOrThrow({ where: { to: "hari@buyer.test" } })).subject).toContain("is live");
    expect(await app.db!.notification.count({ where: { userId: ids.owner, type: "requirement" } })).toBe(1);
  });

  it("leaves the requirement fee setting to platform settings", async () => {
    expect((await call("ops", "PUT", "/admin/settings/requirement-fee", { enabled: true, amount: 500 })).statusCode).toBe(403);
    expect((await call("boss", "PUT", "/admin/settings/requirement-fee", { enabled: true, amount: 0 })).statusCode).toBe(400);
    expect((await call("boss", "PUT", "/admin/settings/requirement-fee", { enabled: true, amount: 500, note: "eSewa" })).statusCode).toBe(200);
    expect((await call("boss", "GET", "/admin/settings/requirement-fee")).json().data).toMatchObject({ enabled: true, amount: 500 });
  });
});

describe("staff", () => {
  it("adds staff with a set-password link, never a password", async () => {
    expect((await call("ops", "POST", "/admin/staff", { email: "new@sheetal.test", name: "New Person", role: "support" })).statusCode).toBe(403);
    expect((await call("boss", "POST", "/admin/staff", { email: "New@Sheetal.test", name: "New Person", role: "content_editor" })).statusCode).toBe(200);
    const mail = await app.db!.outboundEmail.findFirstOrThrow({ where: { to: "new@sheetal.test" } });
    expect(mail.text).toContain("/reset-password/");
    const staff = (await call("boss", "GET", "/admin/staff")).json().data;
    expect(staff.find((s: { email: string }) => s.email === "new@sheetal.test")).toMatchObject({ platformRole: "content_editor", invited: true });
  });

  it("always keeps a super admin and signs out removed staff", async () => {
    expect((await call("boss", "PATCH", `/admin/staff/${ids.boss}`, { role: null })).statusCode).toBe(400);
    expect((await call("boss", "PATCH", `/admin/staff/${ids.help}`, { role: null })).statusCode).toBe(200);
    expect((await call("help", "GET", "/admin/me")).statusCode).toBe(401);
  });
});

describe("system emails", () => {
  it("lists the outbox, opens an email (not in production), and sends a failed one again", async () => {
    const db = app.db!;
    await db.outboundEmail.deleteMany();
    const ok = await db.outboundEmail.create({ data: { to: "sita@gmail.test", subject: "Confirm your email", text: "Open https://sheetal.test/verify/abc", status: "sent", sentAt: new Date() } });
    const bad = await db.outboundEmail.create({ data: { to: "nobody@nowhere.test", subject: "Set a new password", text: "Open https://sheetal.test/reset/xyz", status: "failed", attempts: 1, error: "550 No such user" } });
    expect((await call("owner", "GET", "/admin/email/outbox")).statusCode).toBe(403);
    const list = (await call("boss", "GET", "/admin/email/outbox")).json();
    expect(list.data.map((e: { to: string }) => e.to).sort()).toEqual(["nobody@nowhere.test", "sita@gmail.test"]);
    expect(list.meta).toMatchObject({ counts: { sent: 1, failed: 1 }, showText: true });
    expect((await call("boss", "GET", "/admin/email/outbox?status=failed")).json().data).toHaveLength(1);
    expect((await call("boss", "GET", `/admin/email/outbox/${ok.id}`)).json().data.text).toContain("/verify/abc");
    expect((await call("boss", "POST", `/admin/email/outbox/${bad.id}/resend`)).statusCode).toBe(200);
    expect(await db.outboundEmail.findUniqueOrThrow({ where: { id: bad.id } })).toMatchObject({ status: "queued", attempts: 0, error: null });
  });
});
