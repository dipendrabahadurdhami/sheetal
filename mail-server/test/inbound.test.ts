import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/platform/test/setup-db";
import type { AddressInfo } from "node:net";
import nodemailer from "nodemailer";
import { loadMailConfig } from "../src/config.js";
import { createInboundServer, type InboundPayload } from "../src/inbound.js";
import { seedMail, type Db } from "./helpers.js";

let db: Db;
let port = 0;
let server: ReturnType<typeof createInboundServer>;
const handed: InboundPayload[] = [];
let full = false;

// DNS for SPF/DKIM/DMARC checks: nothing published anywhere (so nothing passes, and nothing hard-fails).
const noDns = async () => { throw Object.assign(new Error("not found"), { code: "ENOTFOUND" }); };

const send = (opts: { to: string[]; subject?: string; text?: string }) =>
  nodemailer.createTransport({ host: "127.0.0.1", port, secure: false, ignoreTLS: true, tls: { rejectUnauthorized: false } }).sendMail({
    from: "A Buyer <buyer@outside.test>", to: opts.to, subject: opts.subject ?? "Price?", text: opts.text ?? "Is it negotiable?",
    attachments: [{ filename: "id.txt", content: "Citizenship" }],
  });

beforeAll(async () => {
  db = (await seedMail(inject("databaseUrl"))).db;
  server = createInboundServer({
    db, config: loadMailConfig({ NODE_ENV: "test", MAIL_HOST: "mail.sheetal.test" }), resolver: noDns,
    handOff: async (p) => { handed.push(p); return full ? { delivered: [], full: p.to, unknown: [] } : { delivered: p.to, full: [], unknown: [] }; },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); await db.$disconnect(); });
beforeEach(() => { handed.length = 0; full = false; });

describe("receiving mail", () => {
  it("takes mail for Sheetal mailboxes and hands it to the business API", async () => {
    const info = await send({ to: ["info@everest.test"] });
    expect(info.accepted).toEqual(["info@everest.test"]);
    expect(handed).toHaveLength(1);
    expect(handed[0]).toMatchObject({ to: ["info@everest.test"], from: "buyer@outside.test", fromName: "A Buyer", subject: "Price?", spam: false });
    expect(handed[0]!.text.trim()).toBe("Is it negotiable?");
    expect(handed[0]!.attachments).toEqual([{ filename: "id.txt", contentType: "text/plain", data: Buffer.from("Citizenship").toString("base64") }]);
  });

  it("refuses unknown addresses straight away, and keeps the known ones", async () => {
    const info = await send({ to: ["info@everest.test", "nobody@everest.test"] });
    expect(info.accepted).toEqual(["info@everest.test"]);
    expect(info.rejected).toEqual(["nobody@everest.test"]);
    expect(handed[0]!.to).toEqual(["info@everest.test"]);
  });

  it("is not an open relay: mail for other domains is refused", async () => {
    await expect(send({ to: ["someone@gmail.com"] })).rejects.toMatchObject({ responseCode: 550 });
    expect(handed).toHaveLength(0);
  });

  it("says 'mailbox full' (try later) when the business has no room", async () => {
    full = true;
    await expect(send({ to: ["info@everest.test"] })).rejects.toMatchObject({ responseCode: 452 });
  });

  it("refuses switched-off mailboxes", async () => {
    await db.mailbox.update({ where: { address: "info@everest.test" }, data: { active: false } });
    await expect(send({ to: ["info@everest.test"] })).rejects.toMatchObject({ responseCode: 550 });
    await db.mailbox.update({ where: { address: "info@everest.test" }, data: { active: true } });
  });
});
