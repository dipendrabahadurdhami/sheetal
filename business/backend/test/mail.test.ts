import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";
import type { Resolver } from "../src/modules/mail/dns.js";

// A fake DNS: tests decide which records "exist".
const dnsTxt = new Map<string, string[]>();
const dnsMx = new Map<string, string>();
const resolver: Resolver = {
  resolveMx: async (n) => (dnsMx.has(n) ? [{ exchange: dnsMx.get(n)!, priority: 10 }] : []),
  resolveTxt: async (n) => (dnsTxt.get(n) ?? []).map((v) => [v]),
};

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const SECRET = "inbound-secret-for-tests-123456";

const call = (who: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids[`${who}Tenant`] ?? ids.tenant } });

async function person(key: string, email: string) {
  const u = await app.db!.user.create({ data: { email, userName: key } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), MAIL_HOST: "mail.sheetal.test", MAIL_INBOUND_SECRET: SECRET }, "business"), { resolver });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, mail_domains RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("owner", "owner@everest.test");
  await person("agent", "sita@everest.test");
  await person("free", "free@small.test");
  const t = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }));
  ids.tenant = t.id;
  const agentRole = await db.role.findFirstOrThrow({ where: { tenantId: t.id, key: "agent" } });
  await db.membership.create({ data: { userId: ids.agent!, tenantId: t.id, roleId: agentRole.id } });
  const f = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.free!, name: "Small Agency", type: "agency" }));
  ids.freeTenant = f.id;
});
afterAll(async () => { await app.close(); });

describe("plans and roles", () => {
  it("keeps team email to paid plans", async () => {
    expect((await call("free", "POST", "/mail/domains", { name: "small.test" })).statusCode).toBe(402);
    expect((await call("free", "GET", "/mail")).json().data).toMatchObject({ paid: false, quota: { limit: 0 } });
  });

  it("unlocks team email for a business on app billing that has the Mail app, for example as a staff gift", async () => {
    const db = app.db!;
    await db.tenant.update({ where: { id: ids.freeTenant }, data: { billingMode: "apps" } });
    // App billing, no Mail app yet: still locked.
    expect((await call("free", "GET", "/mail")).json().data).toMatchObject({ paid: false, quota: { limit: 0 } });
    const grant = await db.entitlementGrant.create({ data: { tenantId: ids.freeTenant!, kind: "app", appId: "mail", key: "full", source: "staff", reason: "own company email", createdBy: ids.free!, endsAt: new Date(Date.now() + 30 * 864e5) } });
    expect((await call("free", "GET", "/mail")).json().data).toMatchObject({ paid: true, quota: { limit: 1024 ** 3 } });
    expect((await call("free", "POST", "/mail/domains", { name: "small.test" })).statusCode).toBe(200);
    // Taking the gift back locks it again (the domain stays, but nothing new can be set up).
    await db.entitlementGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    expect((await call("free", "GET", "/mail")).json().data).toMatchObject({ paid: false, quota: { limit: 0 } });
    expect((await call("free", "POST", "/mail/mailboxes", { domainId: "x", localPart: "info" })).statusCode).toBe(402);
    await db.tenant.update({ where: { id: ids.freeTenant }, data: { billingMode: "plans" } });
    await db.mailDomain.deleteMany({ where: { tenantId: ids.freeTenant } });
  });

  it("lets only owners and managers set up email", async () => {
    expect((await call("agent", "POST", "/mail/domains", { name: "everest.test" })).statusCode).toBe(403);
  });

  it("refuses people outside the business", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/mail", headers: { authorization: `Bearer ${tok.free}`, "x-tenant-id": ids.tenant } });
    expect(res.statusCode).toBe(403);
  });
});

describe("domain", () => {
  it("adds a domain with its DNS records, and verifies once they are all there", async () => {
    const add = await call("owner", "POST", "/mail/domains", { name: "Everest.test" });
    expect(add.statusCode).toBe(200);
    const d = add.json().data;
    ids.domain = d.id;
    expect(d.name).toBe("everest.test");
    expect(d.records.map((r: { id: string }) => r.id)).toEqual(["verify", "mx", "spf", "dkim", "dmarc"]);
    expect(JSON.stringify(d)).not.toContain("PRIVATE KEY");

    let check = (await call("owner", "POST", `/mail/domains/${d.id}/check`)).json().data;
    expect(check.verified).toBe(false);
    expect(check.records.find((r: { id: string }) => r.id === "mx").status).toBe("missing");

    // The business adds the records at its DNS provider.
    for (const r of d.records) {
      if (r.type === "MX") dnsMx.set(r.host, `${r.value}.`);
      else dnsTxt.set(r.host, [...(dnsTxt.get(r.host) ?? []), r.value]);
    }
    check = (await call("owner", "POST", `/mail/domains/${d.id}/check`)).json().data;
    expect(check.verified).toBe(true);
    expect(check.records.every((r: { status: string }) => r.status === "ok")).toBe(true);
  });

  it("stores the signing key encrypted", async () => {
    const row = await app.db!.mailDomain.findUniqueOrThrow({ where: { id: ids.domain } });
    expect(row.dkimPrivateKey.startsWith("v1:")).toBe(true);
    expect(row.dkimPrivateKey).not.toContain("PRIVATE KEY");
  });

  it("won't connect the same domain twice", async () => {
    expect((await call("owner", "POST", "/mail/domains", { name: "everest.test" })).statusCode).toBe(409);
  });
});

describe("mailboxes and mail", () => {
  it("creates personal and shared mailboxes for team members only", async () => {
    const ram = await call("owner", "POST", "/mail/mailboxes", { domainId: ids.domain, local: "ram", name: "Ram", kind: "person", userId: ids.owner });
    expect(ram.json().data.address).toBe("ram@everest.test");
    ids.ram = ram.json().data.id;
    ids.sita = (await call("owner", "POST", "/mail/mailboxes", { domainId: ids.domain, local: "sita", name: "Sita", userId: ids.agent })).json().data.id;
    ids.info = (await call("owner", "POST", "/mail/mailboxes", { domainId: ids.domain, local: "info", name: "Everest Realty", kind: "shared", accessUserIds: [ids.agent] })).json().data.id;
    expect((await call("owner", "POST", "/mail/mailboxes", { domainId: ids.domain, local: "x", name: "X", userId: ids.free })).statusCode).toBe(400);
    expect((await call("owner", "POST", "/mail/mailboxes", { domainId: ids.domain, local: "ram", name: "Again", userId: ids.owner })).statusCode).toBe(409);
  });

  it("shows each person their own and shared mailboxes; the owner sees all", async () => {
    const mine = (await call("agent", "GET", "/mail")).json().data.mailboxes.map((m: { address: string }) => m.address);
    expect(mine.sort()).toEqual(["info@everest.test", "sita@everest.test"]);
    const all = (await call("owner", "GET", "/mail")).json().data;
    expect(all.mailboxes).toHaveLength(3);
    expect(all.canSeeAll).toBe(true);
    expect((await call("agent", "GET", `/mail/mailboxes/${ids.ram}/messages`)).statusCode).toBe(404);
  });

  it("delivers team mail at once and queues outside mail for the mail server", async () => {
    const res = await call("owner", "POST", "/mail/send", {
      mailboxId: ids.ram, to: ["sita@everest.test", "buyer@gmail.com"], subject: "Site visit", text: "Please show the Dhapasi house at 3.",
      attachments: [{ filename: "map.txt", contentType: "text/plain", data: Buffer.from("Dhapasi").toString("base64") }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ delivered: ["sita@everest.test"], queued: ["buyer@gmail.com"] });
    const sent = (await call("owner", "GET", `/mail/mailboxes/${ids.ram}/messages?folder=sent`)).json().data;
    expect(sent[0]).toMatchObject({ subject: "Site visit", status: "queued", attachments: 1 });
    const queue = await app.db!.mailDelivery.findMany({ where: { messageId: sent[0].id } });
    expect(queue.map((d) => [d.recipient, d.status])).toEqual([["buyer@gmail.com", "queued"]]);
    const inbox = await call("agent", "GET", `/mail/mailboxes/${ids.sita}/messages`);
    expect(inbox.json().unread.inbox).toBe(1);
    ids.received = inbox.json().data[0].id;
  });

  it("counts unread email in the person's own and shared mailboxes for the top bar", async () => {
    expect((await call("agent", "GET", "/mail/unread")).json().data.unread).toBe(1); // in sita@
    expect((await call("owner", "GET", "/mail/unread")).json().data.unread).toBe(0); // the owner's own box only, not Sita's
  });

  it("opens, replies in the same thread, and downloads attachments", async () => {
    const m = (await call("agent", "GET", `/mail/messages/${ids.received}`)).json().data;
    expect(m).toMatchObject({ seen: true, fromAddress: "ram@everest.test", text: "Please show the Dhapasi house at 3." });
    const file = await call("agent", "GET", `/mail/attachments/${m.attachments[0].id}`);
    expect(file.body).toBe("Dhapasi");
    await call("agent", "POST", "/mail/send", { mailboxId: ids.sita, to: ["ram@everest.test"], subject: "Re: Site visit", text: "Done.", replyTo: ids.received });
    const ramInbox = (await call("owner", "GET", `/mail/mailboxes/${ids.ram}/messages`)).json().data;
    const reply = (await call("owner", "GET", `/mail/messages/${ramInbox[0].id}`)).json().data;
    expect(reply.thread.map((x: { subject: string }) => x.subject)).toEqual(["Site visit", "Re: Site visit"]);
  });

  it("moves to archive and trash, and deletes for good from trash", async () => {
    expect((await call("agent", "PATCH", `/mail/messages/${ids.received}`, { folder: "archive" })).statusCode).toBe(200);
    expect((await call("agent", "GET", `/mail/mailboxes/${ids.sita}/messages?folder=archive`)).json().meta.total).toBe(1);
    await call("agent", "DELETE", `/mail/messages/${ids.received}`);
    expect((await call("agent", "GET", `/mail/mailboxes/${ids.sita}/messages?folder=trash`)).json().meta.total).toBe(1);
    await call("agent", "DELETE", `/mail/messages/${ids.received}`);
    expect((await call("agent", "GET", `/mail/mailboxes/${ids.sita}/messages?folder=trash`)).json().meta.total).toBe(0);
  });

  it("saves drafts and removes them when sent", async () => {
    const d = (await call("agent", "POST", "/mail/drafts", { mailboxId: ids.info, to: ["ram@everest.test"], subject: "Draft", text: "..." })).json().data;
    expect((await call("agent", "GET", `/mail/mailboxes/${ids.info}/messages?folder=drafts`)).json().meta.total).toBe(1);
    await call("agent", "POST", "/mail/send", { mailboxId: ids.info, to: ["ram@everest.test"], subject: "Draft", text: "Ready", draftId: d.id });
    expect((await call("agent", "GET", `/mail/mailboxes/${ids.info}/messages?folder=drafts`)).json().meta.total).toBe(0);
  });

  it("searches a folder", async () => {
    const hits = (await call("owner", "GET", `/mail/mailboxes/${ids.ram}/messages?folder=sent&q=dhapasi`)).json().data;
    expect(hits.map((x: { subject: string }) => x.subject)).toEqual(["Site visit"]);
  });

  it("counts storage for the whole business", async () => {
    const q = (await call("owner", "GET", "/mail")).json().data.quota;
    expect(q.limit).toBe(1024 ** 3);
    expect(q.used).toBeGreaterThan(0);
  });
});

describe("incoming mail from the mail server", () => {
  const inbound = (body: object, secret = SECRET) => app.inject({ method: "POST", url: "/v1/mail/inbound", payload: body, headers: { "x-mail-secret": secret } });

  it("needs the shared secret", async () => {
    expect((await inbound({ to: ["info@everest.test"], from: "a@b.com", messageId: "<1@b.com>" }, "wrong-secret-wrong-secret-123")).statusCode).toBe(403);
  });

  it("files mail into the right mailbox, cleans HTML, and lists unknown addresses for bouncing", async () => {
    const html = "<p onclick=\"x()\">Is it negotiable?</p><script>alert(1)</script>";
    const res = await inbound({ to: ["info@everest.test", "nobody@everest.test"], from: "buyer@gmail.com", fromName: "A Buyer", subject: "Price?", text: "Is it negotiable?", html, messageId: "<abc@gmail.com>" });
    expect(res.json()).toEqual({ delivered: ["info@everest.test"], full: [], unknown: ["nobody@everest.test"] });
    const list = (await call("agent", "GET", `/mail/mailboxes/${ids.info}/messages`)).json().data;
    const m = (await call("agent", "GET", `/mail/messages/${list[0].id}`)).json().data;
    expect(m.html).toBe("<p>Is it negotiable?</p>");
  });

  it("refuses mail when the business has no email storage", async () => {
    await app.db!.tenant.update({ where: { id: ids.tenant }, data: { planId: "agency-starter" } });
    const res = await inbound({ to: ["info@everest.test"], from: "x@gmail.com", subject: "Hi", text: "Hi", messageId: "<x@gmail.com>" });
    expect(res.statusCode).toBe(404);
    expect(res.json().full).toEqual(["info@everest.test"]);
    await app.db!.tenant.update({ where: { id: ids.tenant }, data: { planId: "agency-business" } });
  });
});
