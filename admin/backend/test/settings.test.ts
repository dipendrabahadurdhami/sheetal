// Tests for the typed settings store, the field builder, the theme and the revenue report on the admin API (stage 1.4; SETTINGS.md sections 2-7).
// Where it fits: runs with the admin API tests (needs the throwaway PostgreSQL): npm run test -w @sheetal/admin-api
// How it works: a real admin API. Staff roles read and change settings over HTTP; the revenue report is checked against rows written straight into the
// invoice and payout-item tables, around the Nepal midnight.
// Rules: the definition's own permission decides; a change is audited with field names (and a reason where one is required); recorded commission is never
// recalculated; a staff member without the permission gets 403 or, for a setting they may not even read, 404.
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
const call = (who: string, method: "GET" | "PUT" | "DELETE", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
async function person(key: string, email: string, platformRole: string | null = null) {
  const u = await app.db!.user.create({ data: { email, userName: key, platformRole, passwordHash: "x" } });
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  return u.id;
}
const SHARE = { commissionPct: 10, perApp: {}, perGateway: {}, technologyPartner: { enabled: true, name: "Tech partner", sharePct: 25, appliesTo: "all", apps: [] }, rounding: "nearest_paisa", effectiveFrom: "2026-01-01" };

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  await app.db!.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, invoices, payout_items RESTART IDENTITY CASCADE`);
  await person("boss", "admin@sheetal.test", "super_admin");
  await person("editor", "editor@sheetal.test", "content_editor");
});
afterAll(async () => { await app.close(); });

describe("settings store", () => {
  it("lists the settings a role may read, with the default until something is saved", async () => {
    const groups = (await call("boss", "GET", "/admin/settings/store")).json().data as { group: string; settings: { key: string; isDefault: boolean; canChange: boolean }[] }[];
    const all = groups.flatMap((g) => g.settings);
    expect(all.map((s) => s.key)).toEqual(expect.arrayContaining(["platform.revenueShare", "platform.theme", "platform.fieldDefs.business_profile"]));
    expect(all.every((s) => s.isDefault && s.canChange)).toBe(true);
    expect(all.some((s) => s.key.startsWith("business."))).toBe(false);
    expect((await call("editor", "GET", "/admin/settings/store")).json().data).toEqual([]);
    expect((await call("editor", "GET", "/admin/settings/store/platform.revenueShare")).statusCode).toBe(404);
    expect((await call("boss", "GET", "/admin/settings/store/business.theme")).statusCode).toBe(404);
    expect((await call("boss", "GET", "/admin/settings/store/nope")).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/admin/settings/store" })).statusCode).toBe(401);
  });

  it("saves the revenue share only with a reason, audits it, and shows the history", async () => {
    expect((await call("boss", "PUT", "/admin/settings/store/platform.revenueShare", { value: SHARE })).statusCode).toBe(400);
    expect((await call("boss", "PUT", "/admin/settings/store/platform.revenueShare", { value: { ...SHARE, commissionPct: 120 }, reason: "Too much on purpose" })).statusCode).toBe(422);
    expect((await call("editor", "PUT", "/admin/settings/store/platform.revenueShare", { value: SHARE, reason: "I should not be able to" })).statusCode).toBe(404);
    const ok = await call("boss", "PUT", "/admin/settings/store/platform.revenueShare", { value: SHARE, reason: "Partner agreement signed" });
    expect(ok.statusCode).toBe(200);
    const one = (await call("boss", "GET", "/admin/settings/store/platform.revenueShare")).json().data;
    expect(one.isDefault).toBe(false);
    expect(one.value.technologyPartner.sharePct).toBe(25);
    expect(one.history[0]).toMatchObject({ fields: ["technologyPartner"], reason: "Partner agreement signed" });
    expect((await call("boss", "PUT", "/admin/settings/store/platform.revenueShare", { value: { ...SHARE, effectiveFrom: "2025-01-01" }, reason: "Trying to rewrite the past" })).json().message).toMatch(/cannot move back/);
    expect((await call("boss", "DELETE", "/admin/settings/store/platform.revenueShare")).statusCode).toBe(400);
    expect(await app.db!.auditLog.count({ where: { action: "settings.platform.revenueShare" } })).toBe(1);
  });

  it("saves a readable theme, refuses an unreadable one, and resets to the default", async () => {
    const theme = { v: 1, colors: { brand: "#0B5FFF", dark: "#101828", light: "#FFFFFF" }, fonts: { heading: null, body: null, nepali: null }, radius: 12, logo: { light: null, dark: null, favicon: null } };
    expect((await call("boss", "PUT", "/admin/settings/store/platform.theme", { value: theme })).statusCode).toBe(200);
    const bad = await call("boss", "PUT", "/admin/settings/store/platform.theme", { value: { ...theme, colors: { ...theme.colors, text: "#F5F5F5" } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/too close to the page colour/);
    expect((await call("boss", "GET", "/admin/settings/store/platform.theme")).json().data.value.radius).toBe(12);
    expect((await call("boss", "DELETE", "/admin/settings/store/platform.theme")).statusCode).toBe(200);
    expect((await call("boss", "GET", "/admin/settings/store/platform.theme")).json().data).toMatchObject({ isDefault: true, value: { colors: { brand: "#9D1D21" } } });
  });

  it("a stored value that no longer fits its definition is ignored, never an error", async () => {
    await app.db!.appSetting.upsert({ where: { key: "platform.theme" }, create: { key: "platform.theme", value: { colours: "all wrong" } }, update: { value: { colours: "all wrong" } } });
    await new Promise((r) => setTimeout(r, 5));
    const res = await call("boss", "GET", "/admin/settings/store/platform.theme");
    expect(res.statusCode).toBe(200);
    expect(["#9D1D21"]).toContain(res.json().data.value.colors.brand);
    await app.db!.appSetting.delete({ where: { key: "platform.theme" } });
  });
});

describe("field builder", () => {
  it("lists the seeded forms and saves a changed one with its version moved on", async () => {
    const forms = (await call("boss", "GET", "/admin/settings/forms")).json();
    expect(forms.data.map((f: { id: string }) => f.id)).toEqual(["company_profile", "business_profile", "business_verification"]);
    expect(forms.meta.canChange).toBe(true);
    const form = forms.data[1];
    const fields = [...form.fields, { key: "opening_hours", type: "text", label: { en: "Opening hours", ne: "खुल्ने समय" }, required: false, filledBy: "business_owner", visibility: "public", editableAfter: "always", order: 500 }];
    const saved = await call("boss", "PUT", "/admin/settings/forms/business_profile", { label: form.label, fields });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ version: 2, edited: true });
    expect(saved.json().data.fields.at(-1).key).toBe("opening_hours");
  });
  it("applies the rules: no delete, no type change, locked fields stay", async () => {
    const form = (await call("boss", "GET", "/admin/settings/forms")).json().data[1];
    const gone = await call("boss", "PUT", "/admin/settings/forms/business_profile", { label: form.label, fields: form.fields.filter((f: { key: string }) => f.key !== "opening_hours") });
    expect(gone.statusCode).toBe(400);
    expect(gone.json().message).toMatch(/Archive it instead/);
    const unlock = await call("boss", "PUT", "/admin/settings/forms/business_profile", { label: form.label, fields: form.fields.map((f: { key: string }) => (f.key === "name" ? { ...f, required: false } : f)) });
    expect(unlock.json().message).toMatch(/must stay required/);
    const archived = await call("boss", "PUT", "/admin/settings/forms/business_profile", { label: form.label, fields: form.fields.map((f: { key: string }) => (f.key === "opening_hours" ? { ...f, archivedAt: new Date().toISOString() } : f)) });
    expect(archived.json().data.version).toBe(3);
    expect((await call("boss", "PUT", "/admin/settings/forms/nope", { label: form.label, fields: [] })).statusCode).toBe(404);
    expect((await call("editor", "PUT", "/admin/settings/forms/business_profile", { label: form.label, fields: form.fields })).statusCode).toBe(403);
    expect((await call("boss", "PUT", "/admin/settings/store/platform.fieldDefs.business_profile", { value: form })).statusCode).toBe(400);   // only through the field builder
  });
});

describe("revenue report", () => {
  it("sums paid invoices and recorded commission by Nepal day, and compares with the period before", async () => {
    const db = app.db!;
    for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
    const ownerId = await person("owner", "owner@biz.test");
    const tenant = await db.$transaction((tx) => createWorkspace(tx, { ownerId, name: "Test Realty", type: "agency", planId: "agency-business" }));
    const branch = await db.branch.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const invoice = (total: number, status: string, paidAt: Date | null) =>
      db.invoice.create({ data: { tenantId: tenant.id, planId: "agency-business", months: 1, subtotal: total, vat: 0, total, status, dueAt: new Date("2026-12-01T00:00:00Z"), paidAt } });
    await invoice(5000, "paid", new Date("2026-11-11T18:14:00Z"));     // 23:59 Nepal time on the 11th
    await invoice(3000, "paid", new Date("2026-11-11T18:20:00Z"));     // 00:05 Nepal time on the 12th
    await invoice(9000, "open", null);                                 // not paid: never counted
    await invoice(2000, "paid", new Date("2026-11-05T06:00:00Z"));     // the period before
    const item = (ref: string, day: string, gross: number, fee: number) =>
      db.payoutItem.create({ data: { tenantId: tenant.id, branchId: branch.id, source: "rent", ref, what: "Rent", gross, feeBp: 1000, fee, net: gross - fee, collectedOn: new Date(`${day}T00:00:00Z`) } });
    await item("a", "2026-11-12", 20000, 2000);
    await item("b", "2026-11-12", -4000, -400);                        // a refund
    await item("c", "2026-11-04", 10000, 1000);                        // the period before

    const res = await call("boss", "GET", "/admin/reports/revenue?range=custom&from=2026-11-11&to=2026-11-12");
    expect(res.statusCode).toBe(200);
    const r = res.json().data;
    expect(r).toMatchObject({ from: "2026-11-11", to: "2026-11-12", days: 2, previousFrom: "2026-11-09", previousTo: "2026-11-10" });
    expect(r.rows.map((x: { key: string }) => x.key)).toEqual(["2026-11-11", "2026-11-12"]);
    expect(r.rows[0].totals.subscriptionPaisa).toBe(500_000);
    expect(r.rows[1].totals).toMatchObject({ subscriptionPaisa: 300_000, grossPaisa: 2_000_000, refundsPaisa: 400_000, commissionPaisa: 160_000, partnerSharePaisa: 40_000, netPaisa: 420_000 });
    expect(r.totals).toMatchObject({ subscriptionPaisa: 800_000, commissionPaisa: 160_000, netPaisa: 920_000 });
    expect(r.totals.netPaisa).toBe(r.rows[0].totals.netPaisa + r.rows[1].totals.netPaisa);        // totals equal the sum of the rows
    expect(r.previous.subscriptionPaisa).toBe(0);
    expect(r.changePct.subscriptionPaisa).toBeNull();

    const wide = (await call("boss", "GET", "/admin/reports/revenue?range=custom&from=2026-11-08&to=2026-11-12")).json().data;
    expect(wide.previous).toMatchObject({ subscriptionPaisa: 200_000, commissionPaisa: 100_000 });
    expect(wide.changePct.subscriptionPaisa).toBe(300);
  });

  it("a change of the commission setting does not change what was recorded", async () => {
    const before = (await call("boss", "GET", "/admin/reports/revenue?range=custom&from=2026-11-11&to=2026-11-12")).json().data.totals.commissionPaisa;
    const SHARE2 = { ...SHARE, commissionPct: 50 };
    expect((await call("boss", "PUT", "/admin/settings/store/platform.revenueShare", { value: SHARE2, reason: "A much higher rate from now on" })).statusCode).toBe(200);
    const after = (await call("boss", "GET", "/admin/reports/revenue?range=custom&from=2026-11-11&to=2026-11-12")).json().data.totals.commissionPaisa;
    expect(after).toBe(before);
  });

  it("refuses staff without the permission and bad ranges, and audits an export", async () => {
    expect((await call("editor", "GET", "/admin/reports/revenue")).statusCode).toBe(403);
    expect((await call("boss", "GET", "/admin/reports/revenue?range=custom&from=2026-11-12&to=2026-11-01")).statusCode).toBe(400);
    expect((await call("boss", "GET", "/admin/reports/revenue?range=year")).statusCode).toBe(422);
    const csv = await call("boss", "GET", "/admin/reports/revenue?range=custom&from=2026-11-11&to=2026-11-12&format=csv");
    expect(csv.statusCode).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.body.split("\n")[0]).toContain("Net to Sheetal");
    expect(csv.body).toContain("2026-11-12,20000.00,4000.00,3000.00,1600.00,400.00,4200.00,2");
    expect(await app.db!.auditLog.count({ where: { action: "platform.revenue.export" } })).toBe(1);
  });
});
