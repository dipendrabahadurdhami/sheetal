// The website's writes into business data go through the apps' rules (P2-W6): an enquiry, a business's online form and the public API create the lead
// through the CRM app's LeadIntake (lead + audit line + "crm.lead.received" event in one transaction), and a signature on the website gets the
// Agreements app's audit line and "agreements.agreement.signed" / "completed" events in the signing transaction. A lead for Sheetal (no business)
// gets its audit line but no event. Nothing is written when the request is refused.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { sha256 } from "@sheetal/platform/auth/secrets";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { buildApp } from "../src/app.js";
import { leadIntake, websiteBus } from "../src/modules/intake.js";

let app: FastifyInstance;
const ids: Record<string, string> = {};
const TOKENS = { p1: "k1-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa", p2: "k2-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb" };
const call = (method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, remoteAddress: `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, headers: { "user-agent": "vitest" } });
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { name }, orderBy: { createdAt: "asc" } });
const audits = (action: string) => app.db!.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "website"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, leads, notifications, outbound_emails, audit_logs, agreements, agreement_signers, event_outbox RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const owner = await db.user.create({ data: { email: "owner@kernel.test", userName: "owner", emailVerifiedAt: new Date() } });
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: "Kernel Realty", type: "agency", planId: "agency-business", email: "office@kernel.test" }))).id;
  ids.branch = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency } })).id;
  await db.listing.create({ data: { code: "SP-0001", slug: "flat-1", tenantId: ids.agency, branchId: ids.branch, purpose: "rent", kind: "rentout", category: "Apartment", propertyType: "Flat", title: "Flat on rent in Baneshwor", status: "published", price: 30000n } });
  await db.agreement.create({ data: { tenantId: ids.agency, branchId: ids.branch, kind: "rent", title: "Rent agreement: Gita", lang: "en", status: "sent", sentAt: new Date(), createdBy: owner.id, textEn: "# Rent", hash: "b".repeat(64), signers: { create: [
    { role: "p1", name: "Ram", email: "ram@owner.test", sort: 0, tokenHash: sha256(TOKENS.p1) },
    { role: "p2", name: "Gita", email: "gita@renter.test", sort: 1, tokenHash: sha256(TOKENS.p2) },
  ] } } });
});
afterAll(async () => { await app.close(); });

describe("an enquiry from the website", () => {
  it("creates the lead with its audit line and its event, for the listing's branch", async () => {
    const r = await call("POST", "/contact-agent", { property_id: 1, name: "Sita", phone: "+977 984-1234567", contact_form: "Is it still available?" });
    expect(r.statusCode).toBe(200);
    const lead = await app.db!.lead.findFirstOrThrow({ where: { kind: "contact_agent" } });
    expect(lead).toMatchObject({ tenantId: ids.agency, branchId: ids.branch, name: "Sita" });
    const [line] = await audits("lead.received");
    expect(line).toMatchObject({ tenantId: ids.agency, actorId: null, target: "Sita", meta: { leadId: lead.id, channel: "website" } });
    const [e] = await events("crm.lead.received");
    expect(e).toMatchObject({ tenantId: ids.agency, branchId: ids.branch, payload: { id: lead.id, channel: "website" }, actor: { kind: "system", job: "website.website" } });
  });

  it("writes nothing when the enquiry is refused", async () => {
    const before = (await events("crm.lead.received")).length;
    expect((await call("POST", "/contact-agent", { property_id: 1, name: "No Contact" })).statusCode).toBe(400);
    expect(await events("crm.lead.received")).toHaveLength(before);
    expect(await audits("lead.received")).toHaveLength(before);
  });
});

describe("the intake itself", () => {
  const info = { requestId: "req-1", ip: "10.0.0.1", log: { warn: () => {}, info: () => {}, error: () => {} } as never };

  it("a lead for Sheetal (no business) gets an audit line but no event", async () => {
    const before = (await events("crm.lead.received")).length;
    const lead = await leadIntake(app).receive(info, { tenantId: null, kind: "service", name: "Walk-in", phone: "9800000001", message: "Need a valuer", ip: "10.0.0.1" }, "website");
    expect(lead.tenantId).toBeNull();
    expect((await audits("lead.received")).at(-1)).toMatchObject({ tenantId: null, target: "Walk-in" });
    expect(await events("crm.lead.received")).toHaveLength(before);
  });

  it("rolls the lead back when the event can't be written (one transaction)", async () => {
    const leadsBefore = await app.db!.lead.count();
    const broken = { publish: async () => { throw new Error("outbox down"); } };
    const { LeadIntake } = await import("@sheetal/app-crm/backend/intake");
    await expect(new LeadIntake(app.db! as never, broken as never).receive(info, { tenantId: ids.agency!, branchId: ids.branch, kind: "api", name: "Lost", phone: "1", message: "x" }, "api")).rejects.toThrow("outbox down");
    expect(await app.db!.lead.count()).toBe(leadsBefore);
  });

  it("refuses an event name no manifest lists (strict outside production)", async () => {
    await expect(app.db!.$transaction((tx) => websiteBus.publish({ requestId: "r", ip: "x", now: new Date(), log: info.log, db: null, tx, actor: { kind: "system", job: "t" }, business: { id: ids.agency! } } as never, "crm.lead.invented", {}, 1))).rejects.toThrow(/not listed/);
  });
});

describe("signing on the website", () => {
  const sign = async (role: "p1" | "p2", token: string) => {
    await app.db!.agreementSigner.updateMany({ where: { role }, data: { otpSentAt: new Date(Date.now() - 120_000) } });
    expect((await call("POST", `/sign/${token}/code`)).statusCode).toBe(200);
    const m = await app.db!.outboundEmail.findFirstOrThrow({ where: { subject: { endsWith: "is your signing code" } }, orderBy: { createdAt: "desc" } });
    return call("POST", `/sign/${token}`, { code: m.subject.slice(0, 6), name: role === "p1" ? "Ram" : "Gita", agree: true });
  };

  it("each signature gets an audit line and an event; the last one also 'completed'", async () => {
    expect((await sign("p1", TOKENS.p1)).statusCode).toBe(200);
    expect(await audits("agreement.signed")).toHaveLength(1);
    expect(await events("agreements.agreement.signed")).toHaveLength(1);
    expect(await events("agreements.agreement.completed")).toHaveLength(0);
    const r = await sign("p2", TOKENS.p2);
    expect(r.json().data).toEqual({ complete: true });
    expect(await audits("agreement.signed")).toHaveLength(2);
    expect((await audits("agreement.signed")).at(-1)).toMatchObject({ tenantId: ids.agency, actorId: null, target: "AG-0001", meta: { name: "Gita" } });
    const [done] = await events("agreements.agreement.completed");
    expect(done).toMatchObject({ tenantId: ids.agency, branchId: ids.branch, payload: { ref: "AG-0001" } });
    expect(await audits("agreement.completed")).toHaveLength(1);
  });
});
