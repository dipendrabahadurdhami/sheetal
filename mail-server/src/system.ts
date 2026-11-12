// Sending system emails (verify email, reset password, invitations, invoices, reminders) from the outbox.
// Where it fits: the APIs save emails to outbound_emails (backend-core/src/lib/mailer.ts); this sends them.
// How it works: "direct" (production) delivers to each recipient's mail server, DKIM-signed with the sending domain
// (added once under business email, like any business domain); "relay" uses an SMTP provider; "file" (development)
// saves .eml files in MAIL_DROP_DIR and marks them sent so links can be opened locally.
// Rules: temporary failures retry for about 3 days; rows are locked while sending, so several servers can share it.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import nodemailer, { type SendMailOptions } from "nodemailer";
import type { Db } from "@sheetal/platform/db/client";
import { Vault } from "@sheetal/platform/auth/vault";
import type { MailConfig } from "./config.js";
import { RETRY_MINUTES, mailServersFor, systemMx, type MxResolver, type SmtpError } from "./outbound.js";

const LOCK_MS = 5 * 60 * 1000;

export interface SystemDeps { db: Db; config: MailConfig; mx?: MxResolver; now?: () => Date; log?: (msg: string, extra?: object) => void }

/** "Name <a@b.c>" or "a@b.c" → its parts. */
export function parseFrom(from: string) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(from);
  const address = (m ? m[2]! : from).trim().toLowerCase();
  return { name: m?.[1]?.trim() || undefined, address, domain: address.split("@")[1] ?? "" };
}

export class SystemSender {
  private readonly vault: Vault;
  private readonly mx: MxResolver;
  private readonly now: () => Date;
  private readonly log: (msg: string, extra?: object) => void;
  private running = false;

  constructor(private readonly deps: SystemDeps) {
    this.vault = new Vault(deps.config.SECRETS_KEY, deps.config.NODE_ENV === "production");
    this.mx = deps.mx ?? systemMx;
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
  }

  /** One pass over the outbox. Returns how many emails were worked on. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const { db, config } = this.deps;
      const now = this.now();
      const due = await db.outboundEmail.findMany({
        where: { status: { in: ["queued", "deferred"] }, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        orderBy: { nextAttemptAt: "asc" }, take: config.OUTBOUND_BATCH, select: { id: true },
      });
      let worked = 0;
      for (const { id } of due) {
        const claimed = await db.outboundEmail.updateMany({ where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + LOCK_MS), status: "sending" } });
        if (!claimed.count) continue;
        await this.send(id);
        worked++;
      }
      return worked;
    } finally {
      this.running = false;
    }
  }

  private async send(id: string) {
    const { db, config } = this.deps;
    const e = await db.outboundEmail.findUniqueOrThrow({ where: { id } });
    const from = parseFrom(config.SYSTEM_MAIL_FROM);
    const mail = { from: from.name ? { name: from.name, address: from.address } : from.address, to: e.to, subject: e.subject, text: e.text, html: e.html ?? undefined, date: e.createdAt };
    const attempt = e.attempts + 1;
    try {
      let response: string;
      if (config.SYSTEM_MAIL_MODE === "file") {
        // Development: keep a copy on disk instead of sending.
        const info = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" }).sendMail(mail);
        const dir = resolve(config.MAIL_DROP_DIR);
        await mkdir(dir, { recursive: true });
        const file = join(dir, `${e.createdAt.toISOString().replace(/[:.]/g, "-")}-${e.id}.eml`);
        await writeFile(file, info.message as Buffer);
        response = `Saved on this computer, not sent: ${file}`;
      } else if (config.SYSTEM_MAIL_MODE === "relay") {
        const transport = nodemailer.createTransport(config.SMTP_RELAY_URL!);
        response = (await transport.sendMail(mail)).response ?? "accepted";
        transport.close();
      } else {
        response = await this.direct(mail, from, e.to);
      }
      await db.outboundEmail.update({ where: { id }, data: { status: "sent", attempts: attempt, sentAt: this.now(), response: response.slice(0, 500), error: null, lockedUntil: null } });
      this.log("system email sent", { to: e.to, subject: e.subject });
    } catch (err) {
      const x = err as SmtpError;
      const permanent = (x.responseCode ?? 0) >= 500 || x.code === "ENOTFOUND" || x.code === "ENODATA";
      const message = (x.response || x.message || "Sending failed").slice(0, 500);
      if (permanent || attempt > RETRY_MINUTES.length) {
        await db.outboundEmail.update({ where: { id }, data: { status: "failed", attempts: attempt, error: message, lockedUntil: null } });
        this.log("system email failed", { to: e.to, error: message });
      } else {
        const wait = RETRY_MINUTES[attempt - 1]!;
        await db.outboundEmail.update({ where: { id }, data: { status: "deferred", attempts: attempt, error: message, nextAttemptAt: new Date(this.now().getTime() + wait * 60_000), lockedUntil: null } });
        this.log("system email deferred", { to: e.to, retryInMinutes: wait, error: message });
      }
    }
  }

  /** Straight to the recipient's mail server, signed with the sending domain's DKIM key. */
  private async direct(mail: SendMailOptions, from: ReturnType<typeof parseFrom>, to: string) {
    const { db, config } = this.deps;
    const domain = await db.mailDomain.findFirst({ where: { name: from.domain }, orderBy: { verified: "desc" } });
    // Unsigned mail from a big domain goes to spam or is refused, so wait (and say why) until the domain is set up.
    if (!domain) throw Object.assign(new Error(`Add ${from.domain} under business email (Domain and email) so system emails can be signed.`), { code: "NO_DOMAIN" });
    let lastErr: SmtpError | null = null;
    for (const host of await mailServersFor(this.mx, to)) {
      try {
        const transport = nodemailer.createTransport({
          host, port: config.OUTBOUND_PORT, secure: false, name: config.MAIL_HOST,
          tls: { rejectUnauthorized: false, servername: host },
          connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 120_000,
          dkim: { domainName: domain.name, keySelector: domain.dkimSelector, privateKey: this.vault.open(domain.dkimPrivateKey) },
        });
        const info = await transport.sendMail({ ...mail, envelope: { from: from.address, to: [to] } });
        transport.close();
        return info.response ?? "accepted";
      } catch (err) {
        lastErr = err as SmtpError;
        if ((lastErr.responseCode ?? 0) >= 500) break;
      }
    }
    throw lastErr ?? new Error("No mail server found for this domain");
  }
}
