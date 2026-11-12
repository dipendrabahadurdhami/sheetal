import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createHmac } from "node:crypto";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { Vault } from "@sheetal/platform/auth/vault";
import type { AiClient } from "@sheetal/backend-core/lib/ai";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const sent: { url: string; body: unknown }[] = [];
let calendar = "";
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("graph.facebook.com")) { sent.push({ url: u, body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify({ messages: [{ id: "wamid" }] })); }
  if (u.includes("airbnb")) return new Response(calendar);
  return new Response("not found", { status: 404 });
}) as typeof fetch;
// The AI, faked: answers with leads, one of them with a phone number that isn't in the text.
const fakeAi = { model: "claude-opus-5-5", credits: { Starter: 3, Business: 2000, Pro: 6000 }, client: {
  messages: { parse: async () => ({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 1500, output_tokens: 300 }, parsed_output: { leads: [
    { name: "Ram Thapa", phone: "9841234567", email: "", need: "Buy a house", budget: "2 crore", location: "Budhanilkantha", note: "" },
    { name: "Made Up", phone: "9800000999", email: "made@up.test", need: "Rent", budget: "", location: "", note: "" },
  ] } }) },
  beta: { messages: { create: async () => ({}) } },
} as unknown as AiClient };

const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.tenant! } });
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10).replace(/-/g, "");

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", API_URL: "https://api.sheetal.test" }, "business"), { fetch: fakeFetch, ai: fakeAi });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, leads, rooms, bookings, ota_feeds, channel_accounts, ai_usage, app_settings, notifications RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const u = await db.user.create({ data: { email: "owner@lakeside.test", userName: "owner", emailVerifiedAt: new Date() } });
  ids.owner = u.id;
  tok.owner = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  ids.tenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: u.id, name: "Lakeside Inn", type: "hotel", planId: "hotel-business" }))).id;
  const head = await db.branch.findFirstOrThrow({ where: { tenantId: ids.tenant } });
  await db.room.createMany({ data: [{ tenantId: ids.tenant, branchId: head.id, no: "101", type: "Deluxe", rate: 6000 }] });
});
afterAll(async () => { await app.close(); });

describe("AI lead finder", () => {
  it("keeps only contact details that are really in the text, and saves them to the Inbox", async () => {
    const text = "Looking for a house in Budhanilkantha around 2 crore, call Ram Thapa 9841234567. Also someone else wants to rent.";
    const r = await call("owner", "POST", "/ai/extract-leads", { text, save: true });
    expect(r.json().data.leads).toEqual([expect.objectContaining({ name: "Ram Thapa", phone: "9841234567" }), expect.objectContaining({ name: "Made Up", phone: "", email: "" })]);
    expect(r.json().data.credits).toBe(2); // 1,800 tokens
    expect(await app.db!.lead.count({ where: { tenantId: ids.tenant, kind: "chat" } })).toBe(2);
    expect((await call("owner", "GET", "/ai/usage")).json().data).toMatchObject({ enabled: true, used: 2, limit: 2000 });
  });

  it("stops when the month's credits are used up", async () => {
    await app.db!.tenant.update({ where: { id: ids.tenant }, data: { planId: "hotel-starter" } });
    await app.db!.aiUsage.create({ data: { tenantId: ids.tenant, feature: "extract_leads", model: "x", inputTok: 1, outputTok: 1, credits: 5 } });
    expect((await call("owner", "POST", "/ai/extract-leads", { text: "Need a flat in Lalitpur, call 9800000000 please." })).statusCode).toBe(402);
    await app.db!.tenant.update({ where: { id: ids.tenant }, data: { planId: "hotel-business" } });
  });
});

describe("calendar sync", () => {
  it("imports stays from Airbnb, updates and cancels them on the next sync, and publishes our busy dates", async () => {
    calendar = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a1\nDTSTART;VALUE=DATE:${day(5)}\nDTEND;VALUE=DATE:${day(8)}\nSUMMARY:Reserved\nEND:VEVENT\nBEGIN:VEVENT\nUID:a2\nDTSTART;VALUE=DATE:${day(10)}\nDTEND;VALUE=DATE:${day(11)}\nSUMMARY:Reserved\nEND:VEVENT\nEND:VCALENDAR`;
    const r = await call("owner", "POST", "/ota/feeds", { type: "Deluxe", site: "airbnb", url: "https://www.airbnb.com/calendar/ical/1.ics" });
    expect(r.json().message).toContain("2 stays imported");
    calendar = calendar.replace(/BEGIN:VEVENT\nUID:a2[\s\S]*?END:VEVENT\n/, "");
    const feed = (await call("owner", "GET", "/ota/feeds")).json().data;
    expect((await call("owner", "POST", `/ota/feeds/${feed.feeds[0].id}/sync`)).json().data).toEqual({ added: 0, updated: 0, cancelled: 1 });
    // Our own feed for Booking.com: the Airbnb stay fills the only Deluxe room, so those days are closed.
    const url = new URL(feed.exports[0].url);
    const ics = await app.inject({ method: "GET", url: url.pathname });
    expect(ics.headers["content-type"]).toContain("text/calendar");
    expect(ics.body).toContain(`DTSTART;VALUE=DATE:${day(5)}\r\nDTEND;VALUE=DATE:${day(8)}`);
    expect((await app.inject({ method: "GET", url: url.pathname.replace(/[^/]+\.ics$/, "forged.ics") })).statusCode).toBe(404);
    // A night closed in the calendar shows as not available too.
    const d30 = day(30);
    const iso = `${d30.slice(0, 4)}-${d30.slice(4, 6)}-${d30.slice(6)}`;
    expect((await call("owner", "PUT", "/calendar/days", { type: "Deluxe", days: [iso], closed: true })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: url.pathname })).body).toContain(`DTSTART;VALUE=DATE:${day(30)}`);
  });
});

describe("WhatsApp", () => {
  it("takes signed messages into the Inbox and replies on WhatsApp", async () => {
    const vault = new Vault(undefined, false);
    await app.db!.appSetting.create({ data: { key: "meta", value: { appSecret: vault.seal("meta-app-secret-123"), verifyToken: vault.seal("verify-token-123") } } });
    expect((await call("owner", "POST", "/channels", { kind: "whatsapp", externalId: "1100223344", name: "Lakeside WhatsApp", accessToken: "EAAG-test-token-1234567890" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token-123&hub.challenge=42" })).body).toBe("42");
    expect((await app.inject({ method: "GET", url: "/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42" })).statusCode).toBe(403);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "1100223344" }, contacts: [{ wa_id: "9779811111111", profile: { name: "Gita" } }], messages: [{ from: "9779811111111", id: "m1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Any room for 2 nights?" } }] } }] }] });
    const post = (b: string, sig: string) => app.inject({ method: "POST", url: "/v1/webhooks/meta", payload: b, headers: { "content-type": "application/json", "x-hub-signature-256": sig } });
    expect((await post(body, "sha256=forged")).statusCode).toBe(401);
    const sig = `sha256=${createHmac("sha256", "meta-app-secret-123").update(body).digest("hex")}`;
    expect((await post(body, sig)).statusCode).toBe(200);
    expect((await post(body, sig)).statusCode).toBe(200); // the same message twice
    const lead = await app.db!.lead.findFirstOrThrow({ where: { contactKey: "whatsapp:9779811111111" }, include: { messages: true } });
    expect(lead).toMatchObject({ name: "Gita", message: "Any room for 2 nights?", messages: [] });
    const r = await call("owner", "POST", `/leads/${lead.id}/reply`, { text: "Yes, Deluxe is free." });
    expect(r.json().message).toBe("Sent on WhatsApp.");
    expect(sent[0]).toEqual({ url: "https://graph.facebook.com/v21.0/1100223344/messages", body: { messaging_product: "whatsapp", to: "9779811111111", type: "text", text: { body: "Yes, Deluxe is free." } } });
    // The token is stored encrypted and never listed.
    expect(JSON.stringify((await call("owner", "GET", "/channels")).json())).not.toContain("EAAG");
  });
});
