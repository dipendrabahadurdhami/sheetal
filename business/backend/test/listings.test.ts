import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-media-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
// The smallest real PNG (1×1 pixel): uploads are opened and saved as WebP sizes, so fake bytes are refused.
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex").toString("base64");

const call = (who: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: object, tenant = ids.agency) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, ...(tenant ? { "x-tenant-id": tenant } : {}) } });

async function person(key: string, email: string) {
  const u = await app.db!.user.create({ data: { email, userName: key, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
async function join_(user: string, tenant: string, roleKey: string) {
  const role = await app.db!.role.findFirstOrThrow({ where: { tenantId: tenant, key: roleKey } });
  await app.db!.membership.create({ data: { tenantId: tenant, userId: ids[user]!, roleId: role.id, status: "active" } });
}
const photo = async (who = "owner") => (await call(who, "POST", "/listing-photos", { data: PNG })).json().data.file as string;
const summary = async (o: object = {}) => ({ title: "3 BHK house for sale in Dhapasi", category: "House", district: "Kathmandu", area: "Dhapasi", price: 25000000, bedrooms: 3, photos: [await photo()], ...o });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, leads, outbound_emails, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, e] of [["owner", "owner@everest.test"], ["agent", "agent@everest.test"], ["agent2", "agent2@everest.test"], ["account", "acc@everest.test"]]) await person(k!, e!);
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business", email: "hello@everest.test" }))).id;
  ids.free = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Free", type: "agency" }))).id;
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Inn", type: "hotel", planId: "hotel-business" }))).id;
  await join_("agent", ids.agency!, "agent");
  await join_("agent2", ids.agency!, "agent");
  await join_("account", ids.agency!, "accountant");
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("listings", () => {
  it("only takes real photos", async () => {
    expect((await call("owner", "POST", "/listing-photos", { data: Buffer.from("<script>alert(1)</script>.....").toString("base64") })).statusCode).toBe(400);
    expect(await photo()).toMatch(/^[A-Za-z0-9_-]{16}\.webp$/);
  });

  it("sends a new listing to Sheetal for review, keeping the form private", async () => {
    const res = await call("owner", "POST", "/listings", { kind: "sell", values: { category: "house", docs: { lalpurja: "lalpurja.pdf" } }, summary: await summary() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: "SP-0001", status: "in_review", price: 25000000, link: null });
    const l = await app.db!.listing.findUniqueOrThrow({ where: { code: "SP-0001" } });
    expect(l).toMatchObject({ status: "pending", purpose: "sale", tenantId: ids.agency, userId: ids.owner });
    expect(l.submittedAt).not.toBeNull();
    expect((l.private as { form: object }).form).toMatchObject({ docs: { lalpurja: "lalpurja.pdf" } });
    expect(l.details).toEqual({});
  });

  it("checks what's missing before review, but saves drafts as they are", async () => {
    const bad = await call("owner", "POST", "/listings", { kind: "sell", summary: { title: "Plot", photos: [] } });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().errors)).toEqual(["title", "location", "photos"]);
    const d = await call("owner", "POST", "/listings", { kind: "rentout", submit: false, summary: { title: "Flat" } });
    expect(d.json().data).toMatchObject({ status: "draft", kind: "rentout" });
  });

  it("refuses photos it didn't upload and kinds the business can't list", async () => {
    expect((await call("owner", "POST", "/listings", { kind: "sell", summary: await summary({ photos: ["../../etc/passwd"] }) })).statusCode).toBe(422);
    expect((await call("owner", "POST", "/listings", { kind: "stay_hotel", summary: await summary() })).statusCode).toBe(403);
  });

  it("keeps the free plan to one listing", async () => {
    expect((await call("owner", "POST", "/listings", { kind: "sell", summary: await summary() }, ids.free)).statusCode).toBe(200);
    const res = await call("owner", "POST", "/listings", { kind: "sell", summary: await summary() }, ids.free);
    expect(res.statusCode).toBe(402);
  });

  it("lists the open business's listings only, with the room left on the plan", async () => {
    const res = (await call("owner", "GET", "/listings")).json();
    expect(res.data.map((l: { id: string }) => l.id).sort()).toEqual(["SP-0001", "SP-0002"]);
    expect(res.meta).toMatchObject({ cap: 150, used: 2, kinds: ["sell", "rentout"] });
    expect((await call("account", "GET", "/listings/SP-0001")).statusCode).toBe(403);
    expect((await call("owner", "GET", "/listings/SP-0003")).statusCode).toBe(404); // the free business's listing
  });

  it("pages, searches and filters on the server, with counts per status", async () => {
    const r = (await call("owner", "GET", "/listings?page=1&per=10&status=in_review")).json();
    expect(r.data.map((l: { id: string }) => l.id)).toEqual(["SP-0001"]);
    expect(r.meta).toMatchObject({ total: 1, counts: { all: 2, in_review: 1, draft: 1 }, listedKinds: expect.arrayContaining(["sell", "rentout"]) });
    expect((await call("owner", "GET", "/listings?page=1&q=dhapasi")).json().data.map((l: { id: string }) => l.id)).toEqual(["SP-0001"]);
    expect((await call("owner", "GET", "/listings?page=1&q=sp-0002")).json().data.map((l: { id: string }) => l.id)).toEqual(["SP-0002"]);
    expect((await call("owner", "GET", "/listings?page=1&kind=rentout")).json().meta.total).toBe(1);
  });

  it("opens the saved form for editing, and edits go back for review", async () => {
    const d = (await call("agent", "GET", "/listings/SP-0001")).json().data;
    expect(d.values).toMatchObject({ category: "house", photos: [expect.objectContaining({ url: expect.stringContaining("/property/main/") })] });
    await app.db!.listing.update({ where: { code: "SP-0001" }, data: { status: "published", publishedAt: new Date() } });
    expect((await call("agent", "PATCH", "/listings/SP-0001", { kind: "sell", submit: false, values: d.values, summary: await summary({ price: 1 }) })).statusCode).toBe(400);
    const res = await call("agent", "PATCH", "/listings/SP-0001", { kind: "sell", values: d.values, summary: await summary({ price: 24000000 }) });
    expect(res.json().message).toContain("off the website");
    expect(await app.db!.listing.findUniqueOrThrow({ where: { code: "SP-0001" } })).toMatchObject({ status: "pending", price: 24000000n });
  });

  it("pauses and publishes again without a new review once approved; drafts are sent for review", async () => {
    await app.db!.listing.update({ where: { code: "SP-0001" }, data: { status: "published" } });
    expect((await call("owner", "POST", "/listings/status", { ids: ["SP-0001"], status: "paused" })).json().data.changed).toEqual(["SP-0001"]);
    expect((await call("owner", "POST", "/listings/status", { ids: ["SP-0001"], status: "published" })).json().message).toBe("Published");
    expect((await app.db!.listing.findUniqueOrThrow({ where: { code: "SP-0001" } })).status).toBe("published");
    // The draft has no photo yet.
    expect((await call("owner", "POST", "/listings/status", { ids: ["SP-0002"], status: "published" })).statusCode).toBe(400);
  });

  it("duplicates as a draft and deletes", async () => {
    const copy = (await call("owner", "POST", "/listings/SP-0001/duplicate")).json().data;
    expect(copy).toMatchObject({ status: "draft", title: "3 BHK house for sale in Dhapasi (copy)" });
    expect((await call("owner", "POST", "/listings/delete", { ids: [copy.id] })).statusCode).toBe(200);
    expect((await call("owner", "GET", `/listings/${copy.id}`)).statusCode).toBe(404);
  });

  it("moves a listing and its enquiries to another business of the same person, if its plan allows the kind", async () => {
    await app.db!.lead.create({ data: { tenantId: ids.agency, listingId: 1, kind: "contact_agent", name: "Ram", email: "ram@buyer.test", message: "Still available?", assigneeId: ids.agent } });
    const targets = (await call("owner", "GET", "/listings/SP-0001/move-targets")).json().data;
    expect(targets).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.hotel, allowed: false }), expect.objectContaining({ id: ids.free, allowed: true })]));
    expect((await call("owner", "POST", "/listings/SP-0001/move", { tenantId: ids.hotel })).statusCode).toBe(400);
    expect((await call("owner", "POST", "/listings/SP-0001/move", { tenantId: ids.free })).statusCode).toBe(402); // the free one is full
    expect((await call("agent", "POST", "/listings/SP-0001/move", { tenantId: ids.free })).statusCode).toBe(403); // not a member there
    await app.db!.listing.update({ where: { code: "SP-0003" }, data: { status: "archived" } });
    expect((await call("owner", "POST", "/listings/SP-0001/move", { tenantId: ids.free })).json().message).toBe("Moved to Everest Free.");
    expect(await app.db!.lead.findFirstOrThrow({ where: { listingId: 1 } })).toMatchObject({ tenantId: ids.free, assigneeId: null });
    await call("owner", "POST", "/listings/SP-0001/move", { tenantId: ids.agency }, ids.free);
  });
});

describe("leads", () => {
  it("shows website enquiries as conversations; agents see their own and unassigned ones", async () => {
    const db = app.db!;
    await db.lead.deleteMany();
    await db.lead.create({ data: { tenantId: ids.agency, listingId: 1, kind: "contact_agent", name: "Gita", email: "gita@buyer.test", message: "Can I visit on Saturday?" } });
    await db.lead.create({ data: { tenantId: ids.agency, kind: "requirement", name: "Bikash", phone: "9800000000", message: "Need land in Lalitpur", assigneeId: ids.agent2 } });
    const all = (await call("owner", "GET", "/leads")).json().data;
    expect(all).toHaveLength(2);
    expect(all.find((l: { name: string }) => l.name === "Gita")).toMatchObject({ channel: "website", stage: "new", unread: 1, listing: "SP-0001", value: 24000000, msgs: [["in", "Can I visit on Saturday?", expect.any(String)]] });
    expect((await call("agent", "GET", "/leads")).json().data.map((l: { name: string }) => l.name)).toEqual(["Gita"]);
    expect((await call("account", "GET", "/leads")).statusCode).toBe(403);
  });

  it("replies by email, moves new leads to contacted and keeps the thread", async () => {
    const gita = (await call("agent", "GET", "/leads")).json().data[0];
    const res = await call("agent", "POST", `/leads/${gita.id}/reply`, { text: "Yes, Saturday 11am works." });
    expect(res.json().message).toBe("Sent to gita@buyer.test.");
    const mail = await app.db!.outboundEmail.findFirstOrThrow({ where: { to: "gita@buyer.test" } });
    expect(mail.text).toContain("Yes, Saturday 11am works.");
    expect(mail.text).toContain("hello@everest.test");
    const after = (await call("agent", "GET", "/leads")).json().data[0];
    expect(after).toMatchObject({ stage: "contacted", assignee: ids.agent, unread: 0, last: "Yes, Saturday 11am works." });
    // Phone-only leads can't be answered by email.
    const bikash = (await call("owner", "GET", "/leads")).json().data.find((l: { name: string }) => l.name === "Bikash");
    expect((await call("owner", "POST", `/leads/${bikash.id}/reply`, { text: "Hi" })).statusCode).toBe(400);
  });

  it("only lets people who assign leads hand them to others", async () => {
    const gita = (await call("owner", "GET", "/leads")).json().data.find((l: { name: string }) => l.name === "Gita");
    expect((await call("agent", "PATCH", `/leads/${gita.id}`, { assignee: ids.agent2 })).statusCode).toBe(403);
    expect((await call("owner", "PATCH", `/leads/${gita.id}`, { assignee: ids.agent2, stage: "viewing", follow: "2026-11-10", tags: ["hot"] })).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/leads/${gita.id}`, { assignee: ids.hotel })).statusCode).toBe(400);
    const l = (await call("agent2", "GET", "/leads")).json().data.find((x: { name: string }) => x.name === "Gita");
    expect(l).toMatchObject({ stage: "viewing", follow: "2026-11-10", tags: ["hot"], assigneeName: "agent2" });
  });
});

describe("notifications", () => {
  it("tells the staff who review listings, not other staff, when a listing is sent for review", async () => {
    const db = app.db!;
    const editor = await db.user.create({ data: { email: "editor@sheetal.test", userName: "Editor", platformRole: "content_editor" } });
    const finance = await db.user.create({ data: { email: "finance@sheetal.test", userName: "Finance", platformRole: "finance" } });
    await call("owner", "POST", "/listings", { kind: "sell", summary: await summary({ title: "Plot for review in Budhanilkantha" }) });
    const toEditor = await db.notification.findMany({ where: { userId: editor.id } });
    expect(toEditor.at(-1)).toMatchObject({ type: "review", title: "Listing to review", link: "/admin/moderation", tenantId: null });
    expect(await db.notification.count({ where: { userId: finance.id } })).toBe(0);
  });

  it("shows each business's bell only its own notifications, and reads them per business", async () => {
    const db = app.db!;
    await db.notification.deleteMany({ where: { userId: ids.owner } });
    await db.notification.createMany({ data: [
      { userId: ids.owner!, tenantId: ids.agency!, type: "lead", title: "New enquiry from Sita", link: "/business/inbox" },
      { userId: ids.owner!, tenantId: ids.agency!, type: "billing", title: "Payment received", link: "/business/billing" },
      { userId: ids.owner!, tenantId: ids.hotel!, type: "booking", title: "2 new Booking.com bookings", link: "/business/bookings" },
      { userId: ids.agent!, tenantId: ids.agency!, type: "lead", title: "Someone else's", link: "/business/inbox" },
    ] });
    const agency = (await call("owner", "GET", "/notifications")).json();
    expect(agency.data.map((n: { title: string }) => n.title).sort()).toEqual(["New enquiry from Sita", "Payment received"]);
    expect(agency.meta.unread).toBe(2);
    expect((await call("owner", "GET", "/notifications", undefined, ids.hotel)).json().data.map((n: { title: string }) => n.title)).toEqual(["2 new Booking.com bookings"]);
    // Reading one, then all, only in this business.
    await call("owner", "POST", `/notifications/${agency.data[0].id}/read`);
    expect((await call("owner", "GET", "/notifications")).json().meta.unread).toBe(1);
    await call("owner", "POST", "/notifications/read-all");
    expect((await call("owner", "GET", "/notifications")).json().meta.unread).toBe(0);
    expect((await call("owner", "GET", "/notifications", undefined, ids.hotel)).json().meta.unread).toBe(1);
    // Someone else's can't be touched.
    const other = await db.notification.findFirstOrThrow({ where: { userId: ids.agent } });
    expect((await call("owner", "DELETE", `/notifications/${other.id}`)).statusCode).toBe(404);
    expect((await call("owner", "DELETE", `/notifications/${agency.data[1].id}`)).statusCode).toBe(200);
  });
});

describe("business verification", () => {
  const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF").toString("base64");
  it("takes documents, sends them to Sheetal once complete, and locks them while checked", async () => {
    const db = app.db!;
    const kyc = await db.user.create({ data: { email: "kyc@sheetal.test", userName: "KYC", platformRole: "operations" } });
    expect((await call("agent", "GET", "/verification")).statusCode).toBe(403); // settings people only
    expect((await call("owner", "GET", "/verification")).json().data).toMatchObject({ status: "none", docs: [] });
    expect((await call("owner", "POST", "/verification/docs", { kind: "pan", data: Buffer.from("not a document at all").toString("base64") })).statusCode).toBe(400);
    expect((await call("owner", "POST", "/verification/docs", { kind: "registration", filename: "registration.pdf", data: PDF })).statusCode).toBe(200);
    const early = await call("owner", "POST", "/verification/submit");
    expect(early.statusCode).toBe(400);
    expect(early.json().message).toContain("PAN/VAT certificate");
    expect((await call("owner", "POST", "/verification/docs", { kind: "pan", filename: "pan.png", data: PNG })).statusCode).toBe(200);
    const v = (await call("owner", "GET", "/verification")).json().data;
    expect(v.docs.map((d: { kind: string }) => d.kind)).toEqual(["registration", "pan"]);
    const file = await call("owner", "GET", `/verification/docs/${v.docs[0].id}/file`);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect((await call("owner", "GET", `/verification/docs/${v.docs[0].id}/file`, undefined, ids.hotel)).statusCode).toBe(404); // another business
    expect((await call("owner", "POST", "/verification/submit")).statusCode).toBe(200);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: ids.agency } })).verification).toBe("pending");
    expect(await db.notification.findFirst({ where: { userId: kyc.id, type: "verification" } })).toMatchObject({ link: "/admin/moderation" });
    // Locked while being checked.
    expect((await call("owner", "DELETE", `/verification/docs/${v.docs[0].id}`)).statusCode).toBe(400);
    expect((await call("owner", "POST", "/verification/docs", { kind: "other", data: PDF })).statusCode).toBe(400);
  });
});
