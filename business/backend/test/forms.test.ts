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
const call = (who: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: object, tenant = ids.agency) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant! } });
const F = (id: string, type: string, label: string, extra: object = {}) => ({ id, type, label, required: false, ph: "", help: "", half: false, min: "", max: "", opts: [], amount: 0, ...extra });
const contactForm = (over: object = {}) => ({
  title: "Contact us", desc: "Ask anything", tpl: "contact", dest: "leads", thanks: "Thanks!",
  fields: [F("n", "short", "Full name", { required: true }), F("p", "phone", "Phone", { required: true }), F("m", "long", "Your message")], ...over,
});

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, leads, forms, form_responses RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent", "accountant", "pokhara", "other", "free"]) {
    const u = await db.user.create({ data: { email: `${k}@forms.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Annapurna Homes", type: "agency", planId: "agency-business" }))).id;
  ids.freeBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.free!, name: "Small Office", type: "agency", planId: "agency-starter" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  ids.pokharaBranch = (await db.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } })).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await role("agent")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.accountant!, roleId: (await role("accountant")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.pokhara!, roleId: (await role("agent")).id, status: "active", scopes: ["Pokhara"] } });
});
afterAll(async () => { await app.close(); });

describe("who can use forms", () => {
  it("lets people who handle leads in, and keeps the accountant out", async () => {
    expect((await call("accountant", "GET", "/forms")).statusCode).toBe(403);
    expect((await call("agent", "GET", "/forms")).statusCode).toBe(200);
    expect((await call("accountant", "POST", "/forms", contactForm())).statusCode).toBe(403);
  });
});

describe("building and publishing", () => {
  it("checks the form: 422 for bad fields", async () => {
    expect((await call("owner", "POST", "/forms", contactForm({ fields: [F("a", "video", "Video")] }))).statusCode).toBe(422);
    expect((await call("owner", "POST", "/forms", contactForm({ fields: [F("a", "short", "A"), F("a", "short", "B")] }))).statusCode).toBe(422);
    expect((await call("owner", "POST", "/forms", contactForm({ title: "" }))).statusCode).toBe(422);
    expect((await call("owner", "POST", "/forms", contactForm({ style: { logoUrl: "javascript:alert(1)" } }))).statusCode).toBe(422);
  });

  it("creates a draft at the picked branch with a slug unique across Sheetal", async () => {
    const r = await call("owner", "POST", "/forms", { ...contactForm(), branchId: ids.head });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ slug: "contact-us", url: "https://sheetal.test/f/contact-us" });
    ids.form = r.json().data.id;
    const other = await call("other", "POST", "/forms", contactForm(), ids.otherBiz);
    expect(other.json().data.slug).toBe("contact-us-2");
    const f = (await call("owner", "GET", `/forms/${ids.form}`)).json().data;
    expect(f).toMatchObject({ status: "draft", title: "Contact us", desc: "Ask anything", branchId: ids.head });
    // Another business can't open it.
    expect((await call("other", "GET", `/forms/${ids.form}`, undefined, ids.otherBiz)).statusCode).toBe(404);
  });

  it("only publishes a form that can be answered", async () => {
    expect((await call("owner", "PUT", `/forms/${ids.form}`, contactForm({ fields: [F("s", "section", "About you")] }))).statusCode).toBe(200); // drafts can be half-done
    expect((await call("owner", "POST", `/forms/${ids.form}/publish`)).statusCode).toBe(400); // nothing to answer
    await call("owner", "PUT", `/forms/${ids.form}`, contactForm({ fields: [F("c", "single", "Pick", { opts: ["Yes", ""] })] }));
    expect((await call("owner", "POST", `/forms/${ids.form}/publish`)).statusCode).toBe(400); // a blank option
    await call("owner", "PUT", `/forms/${ids.form}`, contactForm({ fields: [...contactForm().fields, F("fee", "payment", "Booking fee", { amount: 1000 })] }));
    const noPay = await call("owner", "POST", `/forms/${ids.form}/publish`);
    expect(noPay.statusCode).toBe(400);
    expect(noPay.json().message).toMatch(/QR, eSewa ID or bank/);
    await call("owner", "PUT", `/forms/${ids.form}`, contactForm({ fields: [...contactForm().fields, F("fee", "payment", "Booking fee", { amount: 1000 })], pay: { esewa: "9801111111" } }));
    expect((await call("owner", "POST", `/forms/${ids.form}/publish`)).statusCode).toBe(200);
    expect((await app.db!.form.findUniqueOrThrow({ where: { id: ids.form } })).status).toBe("live");
    // A live form can't be saved unanswerable.
    expect((await call("owner", "PUT", `/forms/${ids.form}`, contactForm({ fields: [] }))).statusCode).toBe(400);
  });

  it("gives leads only to someone who sees leads at the form's branch", async () => {
    expect((await call("owner", "PATCH", `/forms/${ids.form}/assignee`, { assignee: ids.accountant })).statusCode).toBe(400);
    expect((await call("owner", "PATCH", `/forms/${ids.form}/assignee`, { assignee: ids.pokhara })).statusCode).toBe(400);
    expect((await call("owner", "PATCH", `/forms/${ids.form}/assignee`, { assignee: ids.other })).statusCode).toBe(400);
    expect((await call("owner", "PATCH", `/forms/${ids.form}/assignee`, { assignee: ids.agent })).statusCode).toBe(200);
    expect((await call("owner", "GET", "/forms")).json().data.forms[0]).toMatchObject({ assigneeName: "agent", responses: 0, answerable: 4 });
  });

  it("keeps branch-limited people to their branches", async () => {
    expect((await call("pokhara", "GET", "/forms")).json().data.forms).toEqual([]);
    expect((await call("pokhara", "GET", `/forms/${ids.form}`)).statusCode).toBe(404);
    expect((await call("pokhara", "POST", "/forms", { ...contactForm(), branchId: ids.head })).statusCode).toBe(403);
  });

  it("stops a branch with a form being removed", async () => {
    const r = await call("owner", "POST", "/forms", { ...contactForm({ title: "Pokhara visits" }), branchId: ids.pokharaBranch });
    expect(r.statusCode).toBe(200);
    const del = await call("owner", "DELETE", `/branches/${ids.pokharaBranch}`);
    expect(del.statusCode).toBe(400);
    expect(del.json().message).toMatch(/online form/);
  });

  it("holds the free plan to 2 forms", async () => {
    expect((await call("free", "POST", "/forms", contactForm(), ids.freeBiz)).statusCode).toBe(200);
    expect((await call("free", "POST", "/forms", contactForm(), ids.freeBiz)).statusCode).toBe(200);
    const third = await call("free", "POST", "/forms", contactForm(), ids.freeBiz);
    expect(third.statusCode).toBe(400);
    expect(third.json().message).toMatch(/2 forms/);
    expect((await call("free", "GET", "/forms", undefined, ids.freeBiz)).json().data.limits).toMatchObject({ free: true, forms: 2, used: 2, responses: 100 });
  });
});

describe("responses", () => {
  it("lists responses, confirms payments and downloads CSV", async () => {
    const db = app.db!;
    const answers = [
      { id: "n", label: "Full name", type: "short", value: "Sita Sharma", text: "Sita Sharma" },
      { id: "p", label: "Phone", type: "phone", value: "9801234567", text: "9801234567" },
      { id: "m", label: "Your message", type: "long", value: "=SUM(A1)", text: "=SUM(A1)" },
      { id: "fee", label: "Booking fee", type: "payment", value: { amount: 1000, name: "shot.png", file: "AAAAAAAAAAAAAAAA.png" }, text: "Rs. 1,000 · screenshot shot.png" },
    ];
    const lead = await db.lead.create({ data: { tenantId: ids.agency!, branchId: ids.head!, kind: "form", name: "Sita Sharma", phone: "9801234567" } });
    const r = await db.formResponse.create({ data: { formId: ids.form!, tenantId: ids.agency!, answers, name: "Sita Sharma", phone: "9801234567", payAmount: 1000, payStatus: "to_confirm", leadId: lead.id } });
    const list = (await call("agent", "GET", "/forms/responses?dest=leads")).json().data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Sita Sharma", formTitle: "Contact us", pay: { amount: 1000, status: "to_confirm" }, files: [{ label: "Booking fee", name: "shot.png", file: "AAAAAAAAAAAAAAAA.png" }] });
    expect((await call("agent", "GET", "/forms/responses?dest=jobs")).json().data).toEqual([]);
    expect((await call("pokhara", "GET", "/forms/responses")).json().data).toEqual([]);
    expect((await call("owner", "GET", `/forms/responses/${r.id}/files/BBBBBBBBBBBBBBBB.png`)).statusCode).toBe(404);

    expect((await call("agent", "PATCH", `/forms/responses/${r.id}`, { pay: "paid" })).statusCode).toBe(422);
    expect((await call("agent", "PATCH", `/forms/responses/${r.id}`, { pay: "confirmed" })).statusCode).toBe(200);
    expect((await db.formResponse.findUniqueOrThrow({ where: { id: r.id } })).payStatus).toBe("confirmed");
    expect(Number((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).value)).toBe(1000);

    const csv = await call("owner", "GET", `/forms/responses.csv?formId=${ids.form}`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    const lines = csv.body.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("Date,Form,Goes to,Name,Phone,Email,Full name,Phone,Your message,Booking fee,Payment,Payment status");
    expect(lines[1]).toContain("'=SUM(A1)"); // no formulas in Excel
    expect(lines[1]).toContain("confirmed");
  });

  it("unpublishes and removes a form; its leads stay", async () => {
    expect((await call("owner", "POST", `/forms/${ids.form}/unpublish`)).statusCode).toBe(200);
    expect((await app.db!.form.findUniqueOrThrow({ where: { id: ids.form } })).status).toBe("draft");
    expect((await call("owner", "DELETE", `/forms/${ids.form}`)).statusCode).toBe(200);
    expect(await app.db!.formResponse.count({ where: { formId: ids.form } })).toBe(0);
    expect(await app.db!.lead.count({ where: { tenantId: ids.agency, kind: "form" } })).toBe(1);
  });
});
