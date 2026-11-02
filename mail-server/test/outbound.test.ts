import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import mailauth from "mailauth";
import { loadMailConfig } from "../src/config.js";
import { OutboundWorker, RETRY_MINUTES } from "../src/outbound.js";
import { fakeRecipientServer, seedMail, type Db } from "./helpers.js";

let db: Db;
let seed: Awaited<ReturnType<typeof seedMail>>;
let rcpt: Awaited<ReturnType<typeof fakeRecipientServer>>;
let clock = new Date("2026-11-02T10:00:00Z");
const mx = { resolveMx: async (d: string) => { if (d === "gmail.test") return [{ exchange: "127.0.0.1", priority: 10 }]; throw Object.assign(new Error("no such domain"), { code: "ENOTFOUND" }); } };
const worker = () => new OutboundWorker({ db, config: loadMailConfig({ NODE_ENV: "test", MAIL_HOST: "mail.sheetal.test", OUTBOUND_PORT: String(rcpt.port) }), mx, now: () => clock });

async function queue(to: string, subject = "Site visit") {
  const id = `m${Math.random().toString(36).slice(2)}`;
  await db.mailMessage.create({ data: {
    id, mailboxId: seed.ram.id, tenantId: seed.tenant.id, folder: "sent", threadId: id, messageId: `<${id}@everest.test>`,
    fromAddress: "ram@everest.test", fromName: "Ram", to: [to], subject, text: "Please come on Saturday at 11.", size: 100, status: "queued", sentAt: clock,
    attachments: { create: [{ filename: "map.txt", contentType: "text/plain", size: 7, data: Buffer.from("Dhapasi") }] },
    deliveries: { create: [{ recipient: to, tenantId: seed.tenant.id, nextAttemptAt: clock }] },
  } });
  return id;
}

beforeAll(async () => {
  seed = await seedMail(inject("databaseUrl"));
  db = seed.db;
  rcpt = await fakeRecipientServer();
});
afterAll(async () => { await rcpt.close(); await db.$disconnect(); });
beforeEach(async () => { rcpt.answer(null); rcpt.received.length = 0; clock = new Date("2026-11-02T10:00:00Z"); await db.mailDelivery.deleteMany(); });

describe("sending to the internet", () => {
  it("delivers to the recipient's mail server, signed with the domain's DKIM key", async () => {
    const id = await queue("buyer@gmail.test");
    expect(await worker().tick()).toBe(1);
    expect(rcpt.received).toHaveLength(1);
    const got = rcpt.received[0]!;
    expect(got.from).toBe("ram@everest.test");
    expect(got.to).toEqual(["buyer@gmail.test"]);
    expect(got.raw).toContain("Subject: Site visit");
    expect(got.raw).toContain("map.txt");

    // The signature checks out against the public key the business put in its DNS.
    const verified = await mailauth.dkimVerify(Buffer.from(got.raw), {
      resolver: async (name: string) => { if (name === "sheetal._domainkey.everest.test") return [[`v=DKIM1; k=rsa; p=${seed.dkimPublicKey}`]]; throw Object.assign(new Error("none"), { code: "ENOTFOUND" }); },
    });
    expect(verified.results[0]).toMatchObject({ signingDomain: "everest.test", status: { result: "pass" } });

    expect((await db.mailDelivery.findFirstOrThrow({ where: { messageId: id } })).status).toBe("sent");
    expect((await db.mailMessage.findUniqueOrThrow({ where: { id } })).status).toBe("sent");
  });

  it("tries again later when the other server says 'not now'", async () => {
    const id = await queue("buyer@gmail.test");
    rcpt.answer({ code: 451, text: "Greylisted, try again" });
    await worker().tick();
    const d = await db.mailDelivery.findFirstOrThrow({ where: { messageId: id } });
    expect(d).toMatchObject({ status: "deferred", attempts: 1 });
    expect(d.nextAttemptAt.getTime() - clock.getTime()).toBe(RETRY_MINUTES[0]! * 60_000);
    expect(d.lastError).toContain("Greylisted");

    // Not before its time…
    expect(await worker().tick()).toBe(0);
    // …then it goes through.
    rcpt.answer(null);
    clock = new Date(clock.getTime() + RETRY_MINUTES[0]! * 60_000);
    expect(await worker().tick()).toBe(1);
    expect((await db.mailMessage.findUniqueOrThrow({ where: { id } })).status).toBe("sent");
  });

  it("gives up on a permanent 'no' and tells the sender", async () => {
    const id = await queue("nobody@gmail.test", "Price list");
    rcpt.answer({ code: 550, text: "No such user" });
    await worker().tick();
    expect((await db.mailDelivery.findFirstOrThrow({ where: { messageId: id } })).status).toBe("failed");
    const msg = await db.mailMessage.findUniqueOrThrow({ where: { id } });
    expect(msg.status).toBe("failed");
    expect(msg.error).toContain("nobody@gmail.test");
    const notice = await db.mailMessage.findFirstOrThrow({ where: { mailboxId: seed.ram.id, folder: "inbox", subject: "Not delivered: Price list" } });
    expect(notice.text).toContain("nobody@gmail.test");
    expect(notice.threadId).toBe(msg.threadId);
  });

  it("fails at once for a domain that doesn't exist", async () => {
    const id = await queue("someone@no-such-domain.test");
    await worker().tick();
    expect((await db.mailDelivery.findFirstOrThrow({ where: { messageId: id } })).status).toBe("failed");
  });

  it("never sends the same email twice when two servers work the queue", async () => {
    await queue("buyer@gmail.test");
    const [a, b] = await Promise.all([worker().tick(), worker().tick()]);
    expect(a + b).toBe(1);
    expect(rcpt.received).toHaveLength(1);
  });
});
