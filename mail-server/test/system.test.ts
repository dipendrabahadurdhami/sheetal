import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/platform/test/setup-db";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mailauth from "mailauth";
import { loadMailConfig } from "../src/config.js";
import { RETRY_MINUTES } from "../src/outbound.js";
import { SystemSender, parseFrom } from "../src/system.js";
import { fakeRecipientServer, seedMail, type Db } from "./helpers.js";

let db: Db;
let seed: Awaited<ReturnType<typeof seedMail>>;
let rcpt: Awaited<ReturnType<typeof fakeRecipientServer>>;
let clock = new Date("2026-11-03T10:00:00Z");
const mx = { resolveMx: async (d: string) => { if (d === "gmail.test") return [{ exchange: "127.0.0.1", priority: 10 }]; throw Object.assign(new Error("no such domain"), { code: "ENOTFOUND" }); } };
const sender = (env: Record<string, string> = {}) => new SystemSender({
  db, mx, now: () => clock,
  config: loadMailConfig({ NODE_ENV: "test", MAIL_HOST: "mail.sheetal.test", OUTBOUND_PORT: String(rcpt.port), SYSTEM_MAIL_FROM: "Sheetal Property <no-reply@everest.test>", SYSTEM_MAIL_MODE: "direct", ...env }),
});
const queue = (to: string, subject = "Confirm your email") => db.outboundEmail.create({ data: { to, subject, text: `Open this link:\nhttps://sheetal.test/verify/abc`, nextAttemptAt: clock } });

beforeAll(async () => {
  seed = await seedMail(inject("databaseUrl"));
  db = seed.db;
  rcpt = await fakeRecipientServer();
});
afterAll(async () => { await rcpt.close(); await db.$disconnect(); });
beforeEach(async () => { rcpt.answer(null); rcpt.received.length = 0; clock = new Date("2026-11-03T10:00:00Z"); await db.outboundEmail.deleteMany(); });

describe("system emails", () => {
  it("reads the sender's name and address", () => {
    expect(parseFrom("Sheetal Property <No-Reply@Sheetal.com>")).toEqual({ name: "Sheetal Property", address: "no-reply@sheetal.com", domain: "sheetal.com" });
    expect(parseFrom("alerts@sheetal.com")).toMatchObject({ name: undefined, address: "alerts@sheetal.com" });
  });

  it("sends from the outbox to the recipient's mail server, DKIM-signed", async () => {
    const e = await queue("buyer@gmail.test");
    expect(await sender().tick()).toBe(1);
    expect(rcpt.received).toHaveLength(1);
    const got = rcpt.received[0]!;
    expect(got.from).toBe("no-reply@everest.test");
    expect(got.raw).toContain("Subject: Confirm your email");
    expect(got.raw).toContain("From: Sheetal Property <no-reply@everest.test>");
    const verified = await mailauth.dkimVerify(Buffer.from(got.raw), {
      resolver: async (name: string) => { if (name === "sheetal._domainkey.everest.test") return [[`v=DKIM1; k=rsa; p=${seed.dkimPublicKey}`]]; throw Object.assign(new Error("none"), { code: "ENOTFOUND" }); },
    });
    expect(verified.results[0]).toMatchObject({ signingDomain: "everest.test", status: { result: "pass" } });
    expect(await db.outboundEmail.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: "sent", attempts: 1, error: null });
    expect(await sender().tick()).toBe(0); // nothing sent twice
  });

  it("tries again later after a temporary refusal, and gives up on a permanent one", async () => {
    const e = await queue("buyer@gmail.test");
    rcpt.answer({ code: 451, text: "Greylisted, try again" });
    await sender().tick();
    let row = await db.outboundEmail.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({ status: "deferred", attempts: 1 });
    expect(row.nextAttemptAt.getTime()).toBe(clock.getTime() + RETRY_MINUTES[0]! * 60_000);
    expect(await sender().tick()).toBe(0); // not due yet
    clock = new Date(row.nextAttemptAt.getTime() + 1000);
    rcpt.answer({ code: 550, text: "No such user" });
    await sender().tick();
    row = await db.outboundEmail.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({ status: "failed", attempts: 2 });
    expect(row.error).toContain("No such user");
  });

  it("waits, saying why, until the sending domain is set up for signing", async () => {
    const e = await queue("buyer@gmail.test");
    await sender({ SYSTEM_MAIL_FROM: "no-reply@unknown.test" }).tick();
    const row = await db.outboundEmail.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe("deferred");
    expect(row.error).toContain("Add unknown.test under business email");
    expect(rcpt.received).toHaveLength(0);
  });

  it("in development, saves each email as a file instead of sending it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sheetal-mail-"));
    const e = await queue("someone@anywhere.test", "Set a new password");
    await sender({ SYSTEM_MAIL_MODE: "file", MAIL_DROP_DIR: dir }).tick();
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dir, files[0]!), "utf8")).toContain("Subject: Set a new password");
    expect(rcpt.received).toHaveLength(0);
    const row = await db.outboundEmail.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe("sent");
    expect(row.response).toContain("Saved on this computer");
  });

  it("saves files by default in development, and needs a relay address for relay mode", () => {
    expect(loadMailConfig({ NODE_ENV: "development" }).SYSTEM_MAIL_MODE).toBe("file");
    expect(() => loadMailConfig({ NODE_ENV: "development", SYSTEM_MAIL_MODE: "relay" })).toThrow("SMTP_RELAY_URL");
  });
});
