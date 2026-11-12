import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { emails } from "@sheetal/backend-core/lib/mailer";
import { TEMPLATE_DEFS, builtIn, renderText } from "@sheetal/backend-core/domain/templates";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object) => app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
const lastMail = () => app.db!.outboundEmail.findFirstOrThrow({ orderBy: { createdAt: "desc" } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  await app.db!.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, message_templates RESTART IDENTITY CASCADE`);
  await app.db!.outboundEmail.deleteMany();
  for (const [k, role] of [["boss", "super_admin"], ["ops", "operations"]] as const) {
    const u = await app.db!.user.create({ data: { email: `${k}@sheetal.test`, userName: k, platformRole: role, emailVerifiedAt: new Date() } });
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
});
afterAll(async () => { await app.close(); });

describe("built-in wording", () => {
  it("is exactly what the senders used before", () => {
    const vars = { name: "Sita", link: "https://x.test/l" };
    for (const [key, make] of [["verify_email", emails.verify], ["reset_password", emails.reset], ["welcome_back", emails.welcomeBack]] as const) {
      const old = make("a@b.test", "Sita", "https://x.test/l");
      expect(builtIn(key, vars)).toEqual({ subject: old.subject, text: old.text });
    }
    expect(builtIn("plan_renews", { name: "Sita", business: "Lakeside", plan: "Business", in: "3 days", until: "12 Magh 2083", link: "https://s.test/business/billing" })).toEqual({
      subject: "Lakeside: Business renews in 3 days",
      text: "Namaste Sita,\n\nLakeside's Business plan is paid until 12 Magh 2083. The renewal invoice is ready; pay it by eSewa, Khalti, Fonepay or bank transfer to keep everything running.\n\nhttps://s.test/business/billing\n\nSheetal Property",
    });
    expect(builtIn("payment_plan", { name: "Sita", amount: "1,695", what: "Business (1 month)", business: "Lakeside", until: "12 Magh 2083", number: "INV-1", link: "https://s.test/business/billing" }).text)
      .toBe("Namaste Sita,\n\nWe received Rs. 1,695 for Business (1 month). Lakeside is paid until 12 Magh 2083.\n\nInvoice INV-1: https://s.test/business/billing\n\nSheetal Property");
  });
  it("only uses placeholders it lists", () => {
    for (const d of TEMPLATE_DEFS) for (const m of `${d.subject}\n${d.body}`.matchAll(/\{\{(\w+)\}\}/g)) expect([...Object.keys(d.vars), "site"], `${d.key} {{${m[1]}}}`).toContain(m[1]);
  });
});

describe("Admin → Messages", () => {
  it("lists every message for staff with settings access", async () => {
    expect((await call("ops", "GET", "/admin/templates")).statusCode).toBe(403);
    const d = (await call("boss", "GET", "/admin/templates")).json().data;
    expect(d.defs.length).toBe(TEMPLATE_DEFS.length);
    expect(d.saved).toEqual([]);
    expect(d.defs.find((x: { key: string }) => x.key === "verify_email").allowed).toEqual(["name", "link", "site"]);
  });

  it("refuses wording that would break", async () => {
    const put = (key: string, b: object, who = "boss") => call(who, "PUT", `/admin/templates/${key}`, b);
    expect((await put("verify_email", { subject: "Hi", body: "Open {{link}} {{password}}" })).statusCode).toBe(400);
    expect((await put("verify_email", { subject: "", body: "Open {{link}} please" })).statusCode).toBe(400);
    expect((await put("verify_email", { subject: "Hi", body: "No" })).statusCode).toBe(422);
    expect((await put("verify_email", { subject: "Hi", body: "Open {{link}}", lang: "fr" })).statusCode).toBe(422);
    expect((await put("nothing", { subject: "Hi", body: "Open this please" })).statusCode).toBe(404);
    expect((await put("verify_email", { subject: "Hi", body: "Open this please" }, "ops")).statusCode).toBe(403);
    expect(await app.db!.messageTemplate.count()).toBe(0);
  });

  it("changes what a sender sends, and goes back when switched off or reset", async () => {
    const send = () => app.mailer.send(emails.verify("sita@b.test", "Sita", "https://x.test/l"));
    await send();
    expect((await lastMail()).text).toBe(emails.verify("x", "Sita", "https://x.test/l").text); // no saved wording: built-in

    expect((await call("boss", "PUT", "/admin/templates/verify_email", { subject: "Welcome, {{name}}", body: "Hi {{name}}, confirm here: {{link}}\n{{site}}" })).json().message).toBe("Saved.");
    await send();
    const m = await lastMail();
    expect(m.subject).toBe("Welcome, Sita");
    expect(m.text).toBe("Hi Sita, confirm here: https://x.test/l\nhttps://sheetalproperty.com");

    expect((await call("boss", "PUT", "/admin/templates/verify_email", { subject: "Welcome, {{name}}", body: "Hi {{name}}, confirm here: {{link}}\n{{site}}" })).json().message).toBe("Nothing changed.");
    await call("boss", "PUT", "/admin/templates/verify_email", { subject: "Welcome, {{name}}", body: "Hi {{name}}, confirm here: {{link}}\n{{site}}", active: false });
    await send();
    expect((await lastMail()).subject).toBe("Confirm your email");

    await call("boss", "PUT", "/admin/templates/verify_email", { subject: "Welcome, {{name}}", body: "Hi {{name}}, confirm here: {{link}}", active: true });
    expect((await call("boss", "DELETE", "/admin/templates/verify_email")).json().message).toBe("Back to the built-in text.");
    expect((await call("boss", "DELETE", "/admin/templates/verify_email")).json().message).toBe("Already the built-in text.");
    await send();
    expect((await lastMail()).subject).toBe("Confirm your email");
    const a = (await app.db!.auditLog.findMany({ where: { action: { in: ["template.save", "template.reset"] } } })).map((x) => `${x.action} ${x.target}`);
    expect(a).toContain("template.save verify_email · email · en");
    expect(a).toContain("template.save verify_email · email · en (off)");
    expect(a).toContain("template.reset verify_email · email · en");
  });

  it("keeps Nepali wording separate from English", async () => {
    await call("boss", "PUT", "/admin/templates/reset_password", { lang: "ne", subject: "नयाँ पासवर्ड", body: "नमस्ते {{name}}, {{link}}" });
    await app.mailer.send(emails.reset("sita@b.test", "Sita", "https://x.test/r")); // English sender: no English wording saved
    expect((await lastMail()).subject).toBe("Set a new password");
    expect((await call("boss", "GET", "/admin/templates")).json().data.saved).toEqual([expect.objectContaining({ key: "reset_password", lang: "ne" })]);
  });

  it("previews with sample values and sends a test only to the signed-in staff member", async () => {
    const p = (await call("boss", "POST", "/admin/templates/plan_renews/preview", { subject: "{{business}} renews in {{in}}", body: "Hi {{name}}, {{link}}" })).json().data;
    expect(p).toEqual({ subject: "Lakeside Retreat Hotel renews in 3 days", body: "Hi Sita, https://sheetalproperty.com/business/billing" });
    expect(renderText("{{nothing}}x", {})).toBe("x");
    expect((await call("ops", "POST", "/admin/templates/plan_renews/test", { subject: "s", body: "hello there" })).statusCode).toBe(403);
    expect((await call("boss", "POST", "/admin/templates/plan_renews/test", { subject: "{{business}}", body: "Hello {{name}}" })).json().message).toBe("A test went to boss@sheetal.test.");
    const m = await lastMail();
    expect(m).toMatchObject({ to: "boss@sheetal.test", subject: "[Test] Lakeside Retreat Hotel", text: "Hello Sita" });
    expect((await call("boss", "POST", "/admin/templates/plan_renews/test", { subject: "x", body: "{{password}} here" })).statusCode).toBe(400);
  });
});
