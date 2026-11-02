import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { createDb, type Db } from "@sheetal/backend-core/lib/db";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";

// A clean database with one paid agency, its verified domain everest.test (with a real DKIM key pair),
// and mailboxes ram@ (personal) and info@ (shared).
export async function seedMail(databaseUrl: string) {
  const db = createDb(databaseUrl)!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, mail_domains RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const owner = await db.user.create({ data: { email: "owner@everest.test", userName: "Ram" } });
  const tenant = await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: "Everest Realty", type: "agency", planId: "agency-business" }));
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const dkimPublicKey = Buffer.from(publicKey).toString("base64");
  const domain = await db.mailDomain.create({ data: {
    tenantId: tenant.id, name: "everest.test", verified: true, verifyToken: "t", dkimPublicKey,
    dkimPrivateKey: new Vault(undefined, false).seal(String(privateKey)),
  } });
  const ram = await db.mailbox.create({ data: { tenantId: tenant.id, domainId: domain.id, address: "ram@everest.test", name: "Ram", userId: owner.id } });
  const info = await db.mailbox.create({ data: { tenantId: tenant.id, domainId: domain.id, address: "info@everest.test", name: "Everest Realty", kind: "shared" } });
  return { db, tenant, domain, ram, info, dkimPublicKey };
}

/** A pretend mail server on the internet that receives what we send; `reply` decides how it answers RCPT TO. */
export async function fakeRecipientServer() {
  const received: { from: string; to: string[]; raw: string }[] = [];
  let reply: { code: number; text: string } | null = null;
  const server = new SMTPServer({
    authOptional: true, disabledCommands: ["AUTH", "STARTTLS"], logger: false,
    onRcptTo(_a, _s, done) { if (reply) done(Object.assign(new Error(reply.text), { responseCode: reply.code })); else done(); },
    onData(stream, session, done) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString() });
        done();
      });
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.server.address() as AddressInfo).port;
  return { port, received, answer: (r: { code: number; text: string } | null) => { reply = r; }, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export type { Db };
