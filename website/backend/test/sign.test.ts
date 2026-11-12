import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { sha256 } from "@sheetal/platform/auth/secrets";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const ids: Record<string, string> = {};
const TOKENS = { p1: "p1-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa", p2: "p2-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb", gone: "gone-token-cccccccccccccccccccccccccc" };
// Each call from its own address, so the per-minute limits don't get in the way (one test checks them).
const call = (method: "GET" | "POST", url: string, body?: object, ip = `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) =>
  app.inject({ method, url: `/v1${url}`, payload: body, remoteAddress: ip, headers: { "user-agent": "vitest" } });
const lastCode = async (to: string) => {
  const m = await app.db!.outboundEmail.findFirstOrThrow({ where: { to, subject: { endsWith: "is your signing code" } }, orderBy: { createdAt: "desc" } });
  return m.subject.slice(0, 6);
};
const allowNewCode = (role: string) => app.db!.agreementSigner.updateMany({ where: { agreementId: ids.ag, role }, data: { otpSentAt: new Date(Date.now() - 120_000) } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "website"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, agreements, agreement_signers RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const owner = await db.user.create({ data: { email: "owner@everest.test", userName: "owner", emailVerifiedAt: new Date() } });
  ids.owner = owner.id;
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  await db.tenant.update({ where: { id: ids.agency }, data: { email: "office@everest.test" } });
  ids.branch = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency } })).id;
  const base = { tenantId: ids.agency!, branchId: ids.branch, kind: "rent", title: "Rent agreement: Sita Sharma", lang: "both", status: "sent", sentAt: new Date(), createdBy: owner.id, textEn: "# Rent Agreement\n\nThe monthly rent is Rs. 25,000.", textNe: "# घर भाडा सम्झौता\n\nमासिक भाडा रु. २५,००० हुनेछ।", hash: "a".repeat(64) };
  const ag = await db.agreement.create({ data: { ...base, signers: { create: [
    { role: "p1", name: "Hari Shrestha", nameNe: "हरि श्रेष्ठ", email: "hari@owner.test", sort: 0, tokenHash: sha256(TOKENS.p1) },
    { role: "p2", name: "Sita Sharma", nameNe: "सीता शर्मा", email: "sita@renter.test", sort: 1, tokenHash: sha256(TOKENS.p2) },
  ] } } });
  ids.ag = ag.id;
  await db.agreement.create({ data: { ...base, status: "cancelled", cancelNote: "Wrong flat", signers: { create: [{ role: "p1", name: "X", email: "x@x.test", tokenHash: sha256(TOKENS.gone) }] } } });
});
afterAll(async () => { await app.close(); });

describe("opening the link", () => {
  it("shows the frozen texts to the person, not anyone's email in full", async () => {
    const r = await call("GET", `/sign/${TOKENS.p2}`);
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d).toMatchObject({ ref: "AG-0001", status: "sent", business: { name: "Everest Realty" }, me: { role: "p2", name: "Sita Sharma", email: "si••@renter.test", signed: false, codeSent: false } });
    expect(d.texts.ne).toContain("रु. २५,०००");
    expect(d.signers.map((s: { roleLabel: { ne: string } }) => s.roleLabel.ne)).toEqual(["घरधनी", "भाडावाल"]);
    expect(JSON.stringify(d)).not.toContain("hari@owner.test");
    expect((await call("GET", "/sign/not-a-real-token-at-all-xxxxxxxx")).statusCode).toBe(404);
    expect((await call("GET", "/sign/x")).statusCode).toBe(404);
  });

  it("says when the business cancelled it (410)", async () => {
    const r = await call("POST", `/sign/${TOKENS.gone}/code`);
    expect(r.statusCode).toBe(410);
    expect(r.json().message).toMatch(/cancelled/);
  });
});

describe("signing with a code", () => {
  it("emails a 6-digit code, at most one a minute", async () => {
    const r = await call("POST", `/sign/${TOKENS.p2}/code`);
    expect(r.statusCode).toBe(200);
    expect(await lastCode("sita@renter.test")).toMatch(/^\d{6}$/);
    const s = await app.db!.agreementSigner.findFirstOrThrow({ where: { agreementId: ids.ag, role: "p2" } });
    expect(s.otpHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await call("POST", `/sign/${TOKENS.p2}/code`)).statusCode).toBe(400);
  });

  it("checks the request (422) and counts wrong codes; 5 wrong and the code is dead", async () => {
    const code = await lastCode("sita@renter.test");
    expect((await call("POST", `/sign/${TOKENS.p2}`, { code, name: "Sita Sharma" })).statusCode).toBe(422); // no agree tick
    expect((await call("POST", `/sign/${TOKENS.p2}`, { code: "12ab", name: "Sita Sharma", agree: true })).statusCode).toBe(422);
    const wrong = code === "000000" ? "111111" : "000000";
    const first = await call("POST", `/sign/${TOKENS.p2}`, { code: wrong, name: "Sita Sharma", agree: true });
    expect(first.statusCode).toBe(400);
    expect(first.json().message).toMatch(/4 tries left/);
    for (let i = 0; i < 4; i++) await call("POST", `/sign/${TOKENS.p2}`, { code: wrong, name: "Sita Sharma", agree: true });
    const late = await call("POST", `/sign/${TOKENS.p2}`, { code, name: "Sita Sharma", agree: true });
    expect(late.statusCode).toBe(400);
    expect(late.json().message).toMatch(/new one/);
  });

  it("signs with the right code; the business hears about it", async () => {
    await allowNewCode("p2");
    await call("POST", `/sign/${TOKENS.p2}/code`);
    const code = await lastCode("sita@renter.test");
    const r = await call("POST", `/sign/${TOKENS.p2}`, { code, name: "Sita Sharma", agree: true }, "203.0.113.7");
    expect(r.statusCode).toBe(200);
    expect(r.json().data.complete).toBe(false);
    const s = await app.db!.agreementSigner.findFirstOrThrow({ where: { agreementId: ids.ag, role: "p2" } });
    expect(s).toMatchObject({ status: "signed", signedName: "Sita Sharma", channel: "email", ip: "203.0.113.7", userAgent: "vitest", otpHash: null });
    expect((await app.db!.agreement.findUniqueOrThrow({ where: { id: ids.ag } })).status).toBe("sent");
    expect(await app.db!.notification.count({ where: { userId: ids.owner, title: "Sita Sharma signed Rent agreement: Sita Sharma" } })).toBe(1);
    // The same code can't sign twice.
    expect((await call("POST", `/sign/${TOKENS.p2}`, { code, name: "Sita Sharma", agree: true })).statusCode).toBe(400);
    expect((await call("POST", `/sign/${TOKENS.p2}/code`)).statusCode).toBe(400);
  });

  it("completes when the last person signs: emails everyone and shows the signing record", async () => {
    await call("POST", `/sign/${TOKENS.p1}/code`);
    const code = await lastCode("hari@owner.test");
    const r = await call("POST", `/sign/${TOKENS.p1}`, { code, name: "हरि श्रेष्ठ", agree: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.complete).toBe(true);
    const db = app.db!;
    const a = await db.agreement.findUniqueOrThrow({ where: { id: ids.ag } });
    expect(a.status).toBe("signed");
    expect(a.signedAt).not.toBeNull();
    const mails = await db.outboundEmail.findMany({ where: { subject: { startsWith: "Signed by everyone" } } });
    expect(mails.map((m) => m.to).sort()).toEqual(["hari@owner.test", "office@everest.test", "sita@renter.test"]);
    expect(mails.find((m) => m.to === "sita@renter.test")!.text).toContain("a".repeat(64));
    const d = (await call("GET", `/sign/${TOKENS.p2}`)).json().data;
    expect(d.status).toBe("signed");
    expect(d.signers[1]).toMatchObject({ signedName: "Sita Sharma", ip: "203.0.113.7", channel: "email", email: "si••@renter.test" });
    expect(d.signers[1].signedTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(NPT\)$/);
  });

  it("limits codes to 3 a minute from one address", async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await call("POST", `/sign/${TOKENS.gone}/code`, undefined, "10.250.0.9")).statusCode);
    expect(codes.slice(0, 3)).toEqual([410, 410, 410]);
    expect(codes[3]).toBe(429);
  });
});
