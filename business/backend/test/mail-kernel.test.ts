// Tests for business email on the kernel (P2-W6, Workspace part 2): what the move to apps/workspace/backend added. mail.test.ts (the old test: plans,
// roles, domains, mailboxes, sending, inbound) is NOT repeated here and passes unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: setting email up writes its audit line and event in one step (nothing on a refusal); sending writes its event with the message; another
// business's domains, mailboxes and messages are "not found"; a read-only support session reads but changes nothing. Mail rows have no version column;
// deleting is for real (Trash first), as before.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { makeTestContext } from "@sheetal/platform/core/testing/context";
import { Vault } from "@sheetal/platform/auth/vault";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { MailService } from "@sheetal/app-workspace/backend/mail.service";
import type { Resolver } from "@sheetal/app-workspace/backend/mail-dns";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const resolver: Resolver = { resolveMx: async () => [], resolveTxt: async () => [] };
const call = (who: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });
const events = (name: string, tenantId = ids.biz) => app.db!.eventOutbox.count({ where: { tenantId, name } });
const audits = (action: string) => app.db!.auditLog.count({ where: { tenantId: ids.biz, action } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), MAIL_HOST: "mail.sheetal.test" }, "business"), { resolver });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox, mail_domains, mailboxes, mail_messages RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-mail.test`, userName: `km-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
});
afterAll(async () => { await app.close(); });

describe("business email on the kernel", () => {
  it("adding and removing a domain write their audit line and event; a refusal writes nothing", async () => {
    const r = await call("owner", "POST", "/mail/domains", { name: "kernel-mail.test" });
    expect(r.statusCode).toBe(200);
    ids.domain = r.json().data.id;
    expect([await audits("mail.domain_added"), await events("workspace.maildomain.added")]).toEqual([1, 1]);
    const before = [await app.db!.auditLog.count(), await app.db!.eventOutbox.count()];
    expect((await call("owner", "POST", "/mail/domains", { name: "kernel-mail.test" })).statusCode).toBe(409);
    expect([await app.db!.auditLog.count(), await app.db!.eventOutbox.count()]).toEqual(before);
    expect((await call("owner", "POST", `/mail/domains/${ids.domain}/check`)).statusCode).toBe(200);
    expect(await events("workspace.maildomain.checked")).toBe(1);
  });

  it("a mailbox and a sent email write their events with the rows", async () => {
    await app.db!.mailDomain.update({ where: { id: ids.domain }, data: { verified: true } });
    const box = await call("owner", "POST", "/mail/mailboxes", { domainId: ids.domain, local: "info", name: "Everest", kind: "shared" });
    expect(box.json().message).toBe("info@kernel-mail.test is ready.");
    ids.box = box.json().data.id;
    expect([await audits("mail.mailbox_added"), await events("workspace.mailbox.added")]).toEqual([1, 1]);
    const sent = await call("owner", "POST", "/mail/send", { mailboxId: ids.box, to: ["info@kernel-mail.test"], subject: "Hello", text: "Hi team" });
    expect(sent.json().message).toBe("Sent.");
    ids.msg = sent.json().data.id;
    expect(await events("workspace.mail.sent")).toBe(1);
  });

  it("another business's domains, mailboxes and messages are not found", async () => {
    const before = [await app.db!.auditLog.count(), await app.db!.eventOutbox.count(), await app.db!.mailMessage.count()];
    for (const [m, u, b] of [
      ["POST", `/mail/domains/${ids.domain}/check`], ["DELETE", `/mail/domains/${ids.domain}`], ["PATCH", `/mail/mailboxes/${ids.box}`, { name: "Mine" }],
      ["DELETE", `/mail/mailboxes/${ids.box}`, { confirm: "info@kernel-mail.test" }], ["GET", `/mail/mailboxes/${ids.box}/messages`], ["GET", `/mail/messages/${ids.msg}`],
      ["PATCH", `/mail/messages/${ids.msg}`, { starred: true }], ["DELETE", `/mail/messages/${ids.msg}`],
    ] as const) expect((await call("other", m, u, b as object | undefined, ids.otherBiz)).statusCode, `${m} ${u}`).toBe(404);
    expect((await call("other", "GET", "/mail", undefined, ids.otherBiz)).json().data).toMatchObject({ domains: [], mailboxes: [] });
    expect([await app.db!.auditLog.count(), await app.db!.eventOutbox.count(), await app.db!.mailMessage.count()]).toEqual(before);
  });

  it("a read-only support session reads, and changes nothing (not even the read mark)", async () => {
    const REFUSED = { statusCode: 403, message: "This is a read-only support session. Changes are not allowed." };
    const ctx = {
      ...makeTestContext({ db: app.db!, businessId: ids.biz!, branches: [], userId: "support-1", isOwner: false }),
      actor: { kind: "staff" as const, staffId: "support-1", name: "Support", role: "support" },
      impersonation: { staffId: "support-1", reason: "customer asked for help", expiresAt: new Date(Date.now() + 15 * 60_000), readOnly: true },
    };
    const s = new MailService({ bus: app.events!.bus, db: app.db!, vault: new Vault("x".repeat(32), false), resolver, mailHost: "mail.sheetal.test", inboundSecret: undefined });
    const inbox = await app.db!.mailMessage.findFirstOrThrow({ where: { mailboxId: ids.box, folder: "inbox" } });
    await expect(s.overview(ctx)).resolves.toMatchObject({ mailboxes: [expect.objectContaining({ id: ids.box })] });
    await expect(s.read(ctx, inbox.id)).resolves.toMatchObject({ id: inbox.id });
    expect((await app.db!.mailMessage.findUniqueOrThrow({ where: { id: inbox.id } })).seen).toBe(false);
    const before = [await app.db!.auditLog.count(), await app.db!.eventOutbox.count(), await app.db!.mailMessage.count(), await app.db!.mailDomain.count(), await app.db!.mailbox.count()];
    for (const [what, run] of [
      ["add domain", () => s.addDomain(ctx, { name: "x-kernel.test" })], ["check domain", () => s.checkDomain(ctx, ids.domain!)], ["remove domain", () => s.removeDomain(ctx, ids.domain!)],
      ["add mailbox", () => s.addBox(ctx, { domainId: ids.domain, local: "x", name: "X", kind: "shared" })], ["change mailbox", () => s.changeBox(ctx, ids.box!, { name: "Y" })],
      ["remove mailbox", () => s.removeBox(ctx, ids.box!, { confirm: "info@kernel-mail.test" })], ["flag", () => s.flag(ctx, inbox.id, { starred: true })],
      ["trash", () => s.trash(ctx, inbox.id)], ["draft", () => s.saveDraft(ctx, { mailboxId: ids.box, subject: "d" })],
      ["send", () => s.send(ctx, { mailboxId: ids.box, to: ["a@b.test"], subject: "s", text: "t" })],
    ] as const) await expect(run(), what).rejects.toMatchObject(REFUSED);
    expect([await app.db!.auditLog.count(), await app.db!.eventOutbox.count(), await app.db!.mailMessage.count(), await app.db!.mailDomain.count(), await app.db!.mailbox.count()]).toEqual(before);
  });
});
