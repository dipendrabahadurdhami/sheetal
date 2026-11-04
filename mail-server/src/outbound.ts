// Sending business mail to the outside world.
// Where it fits: works through mail_deliveries (one row per outside recipient, made when someone presses Send).
// How it works: each message is signed with its domain's DKIM key and delivered to the recipient domain's mail
// servers (MX) over SMTP, with STARTTLS when offered. Temporary refusals are tried again on a growing schedule
// (about 3 days); permanent ones fail and a "not delivered" notice goes to the sender's inbox.
// Rules: rows are locked while being worked on, so several mail servers can share the queue.

import { promises as nodeDns } from "node:dns";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { Db } from "@sheetal/backend-core/lib/db";
import { Vault } from "@sheetal/backend-core/lib/vault";
import type { MailConfig } from "./config.js";

export interface MxResolver { resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]> }
export const systemMx: MxResolver = { resolveMx: (d) => nodeDns.resolveMx(d) };

/** Minutes to wait after each failed attempt: about 3 days in all before giving up. */
export const RETRY_MINUTES = [5, 15, 30, 60, 120, 240, 480, 720, 1440, 1440];
const LOCK_MS = 5 * 60 * 1000;

/** The recipient domain's mail servers, best first; the domain itself when it has no MX (as the standard says). */
export async function mailServersFor(mx: MxResolver, address: string) {
  const domain = address.split("@")[1]!;
  const rows = await mx.resolveMx(domain).catch((e: SmtpError) => {
    // The domain doesn't exist at all: no point trying again.
    if (e.code === "ENOTFOUND") throw Object.assign(new Error(`The domain ${domain} doesn't exist`), { responseCode: 550 });
    if (e.code === "ENODATA") return []; // exists but has no MX: use the domain itself
    throw e;
  });
  const hosts = rows.filter((r) => r.exchange && r.exchange !== ".").sort((a, b) => a.priority - b.priority).map((r) => r.exchange.replace(/\.$/, ""));
  return hosts.length ? hosts : [domain];
}

export interface OutboundDeps { db: Db; config: MailConfig; mx?: MxResolver; now?: () => Date; log?: (msg: string, extra?: object) => void }

export type SmtpError = Error & { responseCode?: number; response?: string; code?: string };

export class OutboundWorker {
  private readonly vault: Vault;
  private readonly mx: MxResolver;
  private readonly now: () => Date;
  private readonly log: (msg: string, extra?: object) => void;
  private running = false;

  constructor(private readonly deps: OutboundDeps) {
    this.vault = new Vault(deps.config.SECRETS_KEY, deps.config.NODE_ENV === "production");
    this.mx = deps.mx ?? systemMx;
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
  }

  /** One pass over the queue. Returns how many deliveries were worked on. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const { db, config } = this.deps;
      const now = this.now();
      const due = await db.mailDelivery.findMany({
        where: { status: { in: ["queued", "deferred"] }, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        orderBy: { nextAttemptAt: "asc" }, take: config.OUTBOUND_BATCH, select: { id: true },
      });
      let worked = 0;
      for (const { id } of due) {
        // Claim it; if another server got there first, skip.
        const claimed = await db.mailDelivery.updateMany({ where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + LOCK_MS), status: "sending" } });
        if (!claimed.count) continue;
        await this.deliver(id);
        worked++;
      }
      return worked;
    } finally {
      this.running = false;
    }
  }

  private async deliver(id: string) {
    const { db, config } = this.deps;
    const d = await db.mailDelivery.findUniqueOrThrow({ where: { id }, include: { message: { include: { attachments: true, mailbox: { include: { domain: true } } } } } });
    const m = d.message;
    const domain = m.mailbox.domain;
    const attempt = d.attempts + 1;
    try {
      const hosts = await this.mailServersFor(d.recipient);
      let lastErr: SmtpError | null = null;
      for (const host of hosts) {
        try {
          const transport = nodemailer.createTransport({
            host, port: config.OUTBOUND_PORT, secure: false, name: config.MAIL_HOST,
            // Use encryption whenever the other server offers it; many servers on the internet have self-signed certificates.
            tls: { rejectUnauthorized: false, servername: host },
            connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 120_000,
            dkim: { domainName: domain.name, keySelector: domain.dkimSelector, privateKey: this.vault.open(domain.dkimPrivateKey) },
          });
          const info = await transport.sendMail({
            envelope: { from: m.fromAddress, to: [d.recipient] },
            from: m.fromName ? { name: m.fromName, address: m.fromAddress } : m.fromAddress,
            to: m.to, cc: m.cc, subject: m.subject, text: m.text, html: m.html ?? undefined,
            messageId: m.messageId, inReplyTo: m.inReplyTo ?? undefined, references: m.inReplyTo ?? undefined,
            date: m.sentAt ?? m.createdAt,
            attachments: m.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.data) })),
          });
          transport.close();
          await db.mailDelivery.update({ where: { id }, data: { status: "sent", attempts: attempt, sentAt: this.now(), response: info.response?.slice(0, 500), lastError: null, lockedUntil: null } });
          this.log("sent", { to: d.recipient, via: host });
          await this.settle(m.id);
          return;
        } catch (err) {
          lastErr = err as SmtpError;
          if ((lastErr.responseCode ?? 0) >= 500) break; // a clear "no": other servers of the same domain would say the same
        }
      }
      throw lastErr ?? new Error("No mail server found for this domain");
    } catch (err) {
      const e = err as SmtpError;
      const permanent = (e.responseCode ?? 0) >= 500 || e.code === "ENOTFOUND" || e.code === "ENODATA";
      const message = (e.response || e.message || "Delivery failed").slice(0, 500);
      if (permanent || attempt > RETRY_MINUTES.length) {
        await db.mailDelivery.update({ where: { id }, data: { status: "failed", attempts: attempt, lastError: message, lockedUntil: null } });
        this.log("failed", { to: d.recipient, error: message });
        await this.settle(m.id);
      } else {
        const wait = RETRY_MINUTES[attempt - 1]!;
        await db.mailDelivery.update({ where: { id }, data: { status: "deferred", attempts: attempt, lastError: message, nextAttemptAt: new Date(this.now().getTime() + wait * 60_000), lockedUntil: null } });
        this.log("deferred", { to: d.recipient, retryInMinutes: wait, error: message });
      }
    }
  }

  private mailServersFor(address: string) { return mailServersFor(this.mx, address); }

  /** When every outside recipient of a message is done: mark it sent or failed, and tell the sender about failures. */
  private async settle(messageId: string) {
    const { db, config } = this.deps;
    const all = await db.mailDelivery.findMany({ where: { messageId } });
    if (all.some((x) => !["sent", "failed"].includes(x.status))) return;
    const failed = all.filter((x) => x.status === "failed");
    const m = await db.mailMessage.update({ where: { id: messageId }, data: { status: failed.length ? "failed" : "sent", error: failed.length ? failed.map((f) => `${f.recipient}: ${f.lastError}`).join("\n").slice(0, 2000) : null } });
    if (!failed.length) return;
    const text = [
      "Your email could not be delivered to:",
      ...failed.map((f) => `  ${f.recipient}\n    ${f.lastError}`),
      "",
      `Subject: ${m.subject || "(no subject)"}`,
      "Check the address and try again. If it keeps failing, the other side may be blocking mail; ask them another way.",
    ].join("\n");
    const id = randomUUID().replace(/-/g, "");
    await db.mailMessage.create({ data: {
      id, mailboxId: m.mailboxId, tenantId: m.tenantId, folder: "inbox", threadId: m.threadId, messageId: `<${id}@${config.MAIL_HOST}>`, inReplyTo: m.messageId,
      fromAddress: `mailer-daemon@${config.MAIL_HOST}`, fromName: "Mail delivery", to: [m.fromAddress], subject: `Not delivered: ${m.subject || "(no subject)"}`,
      text, snippet: text.replace(/\s+/g, " ").slice(0, 160), size: Buffer.byteLength(text), status: "received", sentAt: this.now(),
    } });
  }
}
