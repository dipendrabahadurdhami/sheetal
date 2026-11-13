// Tests for online forms and Import / Export on the kernel (P2-W6, Workspace part 2): what the move to apps/workspace/backend added. forms.test.ts and
// settings.test.ts (the old tests, which also cover export/import) are NOT repeated here and pass unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: covers each change writing its audit line and its event in one step (and nothing on a refusal), the form kernel columns and a stale save (409),
// isolation (another business's forms and responses are "not found", its rows never exported), an import that is all rows or none, the listing codes an
// import gives, and a read-only support session. Forms are removed for real (their responses go with them, as before): no soft delete.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { makeTestContext } from "@sheetal/platform/core/testing/context";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { FormService } from "@sheetal/app-workspace/backend/form.service";
import { DataService } from "@sheetal/app-workspace/backend/data.service";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });
const events = (name: string) => app.db!.eventOutbox.count({ where: { tenantId: ids.biz, name } });
const audits = (action: string) => app.db!.auditLog.count({ where: { tenantId: ids.biz, action } });
const F = (id: string, type: string, label: string, extra: object = {}) => ({ id, type, label, required: false, ph: "", help: "", half: false, min: "", max: "", opts: [], amount: 0, ...extra });
const form = (over: object = {}) => ({ title: "Contact us", dest: "leads", fields: [F("n", "short", "Full name", { required: true }), F("p", "phone", "Phone", { required: true })], ...over });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox, leads, listings, forms, form_responses RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-fd.test`, userName: `kf-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.biz } })).id;
});
afterAll(async () => { await app.close(); });

describe("online forms on the kernel", () => {
  it("creates with the kernel columns, its audit line and event; a stale save is refused", async () => {
    const r = await call("owner", "POST", "/forms", form());
    expect(r.json().message).toBe("Form created.");
    ids.form = r.json().data.id;
    expect(await app.db!.form.findUniqueOrThrow({ where: { id: ids.form } })).toMatchObject({ createdBy: ids.owner, updatedBy: ids.owner, version: 1 });
    expect([await audits("form.created"), await events("workspace.form.created")]).toEqual([1, 1]);
    expect((await call("owner", "GET", `/forms/${ids.form}`)).json().data.version).toBe(1);
    expect((await call("owner", "PUT", `/forms/${ids.form}`, form({ title: "Contact", version: 1 }))).statusCode).toBe(200);
    expect((await call("owner", "PUT", `/forms/${ids.form}`, form({ title: "Old tab", version: 1 }))).statusCode).toBe(409);
    expect((await call("owner", "PUT", `/forms/${ids.form}`, form({ title: "No version sent" }))).statusCode).toBe(200);   // the builder today sends none
    expect(await events("workspace.form.saved")).toBe(2);
    expect(await audits("form.saved")).toBe(0);   // saves write no audit line (the builder saves after each change)
    expect((await call("owner", "POST", `/forms/${ids.form}/publish`)).statusCode).toBe(200);
    expect((await call("owner", "POST", `/forms/${ids.form}/unpublish`)).statusCode).toBe(200);
    expect([await events("workspace.form.published"), await events("workspace.form.unpublished"), await audits("form.published"), await audits("form.unpublished")]).toEqual([1, 1, 1, 1]);
  });

  it("confirms a payment: the response, the lead's value, the audit line and the event together", async () => {
    const lead = await app.db!.lead.create({ data: { tenantId: ids.biz!, branchId: ids.head!, kind: "contact_agent", name: "Sita", message: "Hi" } });
    const resp = await app.db!.formResponse.create({ data: { formId: ids.form!, tenantId: ids.biz!, answers: [], name: "Sita", phone: "9801234567", payAmount: 1000, payStatus: "to_confirm", leadId: lead.id } });
    ids.resp = resp.id;
    expect((await call("owner", "PATCH", `/forms/responses/${resp.id}`, { pay: "confirmed" })).json().message).toBe("Payment confirmed.");
    expect((await app.db!.lead.findUniqueOrThrow({ where: { id: lead.id } })).value).toBe(1000n);
    expect([await audits("form.payment_confirmed"), await events("workspace.response.checked")]).toEqual([1, 1]);
  });

  it("another business's forms and responses are not found, and a refusal writes nothing", async () => {
    const before = [await app.db!.auditLog.count(), await app.db!.eventOutbox.count()];
    for (const [m, u, b] of [["GET", `/forms/${ids.form}`], ["PUT", `/forms/${ids.form}`, form()], ["POST", `/forms/${ids.form}/publish`], ["DELETE", `/forms/${ids.form}`], ["PATCH", `/forms/responses/${ids.resp}`, { pay: "rejected" }]] as const) {
      expect((await call("other", m, u, b as object | undefined, ids.otherBiz)).statusCode, `${m} ${u}`).toBe(404);
    }
    expect((await call("other", "GET", "/forms", undefined, ids.otherBiz)).json().data.forms).toEqual([]);
    expect([await app.db!.auditLog.count(), await app.db!.eventOutbox.count()]).toEqual(before);
  });

  it("refuses every change in a read-only support session", async () => {
    const REFUSED = { statusCode: 403, message: "This is a read-only support session. Changes are not allowed." };
    const ctx = {
      ...makeTestContext({ db: app.db!, businessId: ids.biz!, branches: [{ id: ids.head! }], userId: "support-1", isOwner: false }),
      actor: { kind: "staff" as const, staffId: "support-1", name: "Support", role: "support" },
      impersonation: { staffId: "support-1", reason: "customer asked for help", expiresAt: new Date(Date.now() + 15 * 60_000), readOnly: true },
    };
    const s = new FormService({ bus: app.events!.bus, siteUrl: "https://sheetal.test", readFile: async () => null });
    const d = new DataService({ bus: app.events!.bus, catalogKinds: () => undefined });
    const before = [await app.db!.form.count(), await app.db!.listing.count(), await app.db!.auditLog.count(), await app.db!.eventOutbox.count()];
    await expect(s.browse(ctx)).resolves.toMatchObject({ forms: [expect.objectContaining({ id: ids.form })] });
    for (const [what, run] of [
      ["create", () => s.makeForm(ctx, form())], ["save", () => s.saveForm(ctx, ids.form!, form())], ["publish", () => s.publish(ctx, ids.form!)],
      ["unpublish", () => s.unpublish(ctx, ids.form!)], ["remove", () => s.removeForm(ctx, ids.form!)], ["assignee", () => s.setAssignee(ctx, ids.form!, { assignee: null })],
      ["payment", () => s.checkPayment(ctx, ids.resp!, { pay: "rejected" })],
      ["import listings", () => d.importRows(ctx, "listings", { rows: [{ title: "Land in Bhaisepati", purpose: "Sale", type: "Land", district: "Lalitpur", area: "Bhaisepati" }] })],
    ] as const) await expect(run(), what).rejects.toMatchObject(REFUSED);
    expect([await app.db!.form.count(), await app.db!.listing.count(), await app.db!.auditLog.count(), await app.db!.eventOutbox.count()]).toEqual(before);
  });

  it("removes a form with its line and event", async () => {
    expect((await call("owner", "DELETE", `/forms/${ids.form}`)).json().message).toBe("No version sent removed. Its leads stay in the Inbox.");
    expect([await audits("form.removed"), await events("workspace.form.removed")]).toEqual([1, 1]);
    expect(await app.db!.formResponse.count({ where: { formId: ids.form } })).toBe(0);
  });
});

describe("Import / Export on the kernel", () => {
  const row = (n: number) => ({ title: `House number ${n}`, purpose: "Sale", type: "House", district: "Lalitpur", area: "Jhamsikhel", price: 1000 + n });

  it("imports listings as drafts with the business's codes, one audit line and one event", async () => {
    const r = await call("owner", "POST", "/data/listings", { rows: [row(1), row(2), row(3)] });
    expect(r.json()).toMatchObject({ data: { imported: 3 } });
    const made = await app.db!.listing.findMany({ where: { tenantId: ids.biz }, orderBy: { id: "asc" } });
    expect(made).toHaveLength(3);
    for (const l of made) {
      expect(l.code).toMatch(/^[A-Z][A-Z0-9]{1,4}-\d{4,}$/);
      expect(l.code.endsWith(String(l.id).padStart(4, "0"))).toBe(true);
      expect(l.slug).toBe(`${l.title.toLowerCase().replace(/ /g, "-")}-${l.id}`);
      expect(l).toMatchObject({ status: "draft", branchId: ids.head, createdBy: ids.owner, userId: ids.owner });
    }
    expect([await audits("data.import_listings"), await events("workspace.data.imported")]).toEqual([1, 1]);
    const e = await app.db!.eventOutbox.findFirstOrThrow({ where: { tenantId: ids.biz, name: "workspace.data.imported" } });
    expect(e.payload).toEqual({ kind: "listings", count: 3 });
  });

  it("is all rows or none: one bad row and nothing is added", async () => {
    const before = await app.db!.listing.count();
    expect((await call("owner", "POST", "/data/listings", { rows: [row(4), { ...row(5), title: "x" }] })).statusCode).toBe(422);
    expect(await app.db!.listing.count()).toBe(before);
  });

  it("imports leads with their line and event, and never exports another business's rows", async () => {
    expect((await call("owner", "POST", "/data/leads", { rows: [{ name: "Rita", phone: "9815550011", stage: "Visit" }] })).statusCode).toBe(200);
    expect([await audits("data.import_leads"), await events("workspace.data.imported")]).toEqual([1, 2]);
    expect((await call("other", "GET", "/data/listings", undefined, ids.otherBiz)).json().data).toEqual([]);
    expect((await call("other", "GET", "/data/leads", undefined, ids.otherBiz)).json().data).toEqual([]);
    expect((await call("owner", "GET", "/data/leads")).json().data).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Rita", stage: "Visit" })]));
  });
});
