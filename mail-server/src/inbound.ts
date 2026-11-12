// Receiving mail for business domains (SMTP, port 25).
// Where it fits: other mail servers connect here; accepted mail is handed to the business API (POST /v1/mail/inbound).
// How it works: only addresses of active Sheetal mailboxes are accepted (others are refused at once, so the sender is
// told); each message is checked with SPF, DKIM and DMARC: forged mail whose domain asks for rejection is refused,
// other failures go to Spam.
// Rules: this server never relays: it only takes mail for Sheetal mailboxes and has no login for sending.

import { readFileSync } from "node:fs";
import { SMTPServer, type SMTPServerAddress, type SMTPServerSession } from "smtp-server";
import { simpleParser, type AddressObject } from "mailparser";
import mailauth from "mailauth";
import type { Db } from "@sheetal/platform/db/client";
import type { MailConfig } from "./config.js";

export interface InboundPayload {
  to: string[]; from: string; fromName?: string; cc: string[]; subject: string; text: string; html?: string;
  messageId: string; inReplyTo?: string; spam: boolean;
  attachments: { filename: string; contentType: string; data: string }[];
}
export type HandOff = (p: InboundPayload) => Promise<{ delivered: string[]; full: string[]; unknown: string[] }>;
type DnsResolver = (domain: string, rrtype: string) => Promise<string[][] | string[]>;

export interface InboundDeps { db: Db; config: MailConfig; handOff: HandOff; resolver?: DnsResolver; log?: (msg: string, extra?: object) => void }

const smtpError = (code: number, message: string) => Object.assign(new Error(message), { responseCode: code });
const addressesOf = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value).map((v) => v.address?.toLowerCase()).filter((v): v is string => !!v);

/** Sends incoming mail to the business API. */
export const apiHandOff = (config: MailConfig): HandOff => async (payload) => {
  const res = await fetch(`${config.BUSINESS_API_URL}/mail/inbound`, {
    method: "POST", headers: { "content-type": "application/json", "x-mail-secret": config.MAIL_INBOUND_SECRET ?? "" }, body: JSON.stringify(payload),
  });
  if (res.status !== 200 && res.status !== 404) throw new Error(`Business API answered ${res.status}`);
  return (await res.json()) as Awaited<ReturnType<HandOff>>;
};

export function createInboundServer({ db, config, handOff, resolver, log = () => {} }: InboundDeps) {
  const maxBytes = config.MAX_MESSAGE_MB * 1024 * 1024;
  const tls = config.TLS_KEY_PATH && config.TLS_CERT_PATH ? { key: readFileSync(config.TLS_KEY_PATH), cert: readFileSync(config.TLS_CERT_PATH) } : null;

  return new SMTPServer({
    name: config.MAIL_HOST,
    banner: "Sheetal mail",
    size: maxBytes,
    authOptional: true,
    disabledCommands: ["AUTH"],
    ...(tls ? { key: tls.key, cert: tls.cert } : { hideSTARTTLS: true }),
    logger: false,

    async onRcptTo(address: SMTPServerAddress, session: SMTPServerSession, done: (err?: Error | null) => void) {
      const to = address.address.toLowerCase();
      if (session.envelope.rcptTo.length >= 100) return done(smtpError(452, "Too many recipients"));
      const box = await db.mailbox.findFirst({ where: { address: to, active: true }, select: { id: true } }).catch(() => undefined);
      if (box === undefined) return done(smtpError(451, "Temporary problem, please try again later"));
      if (!box) return done(smtpError(550, `No such user here: ${to}`));
      done();
    },

    onData(stream, session, done) {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (c: Buffer) => { size += c.length; if (size <= maxBytes) chunks.push(c); });
      stream.on("end", async () => {
        if (stream.sizeExceeded || size > maxBytes) return done(smtpError(552, "Message is too big"));
        try {
          const raw = Buffer.concat(chunks);
          const mailFrom = session.envelope.mailFrom ? session.envelope.mailFrom.address.toLowerCase() : "";
          const auth = await mailauth.authenticate(raw, {
            ip: session.remoteAddress, helo: session.hostNameAppearsAs, sender: mailFrom, mta: config.MAIL_HOST, resolver, disableBimi: true, disableArc: true,
          });
          const dmarc = auth.dmarc ? (auth.dmarc as unknown as { status?: { result?: string }; policy?: string }) : null;
          const dmarcFail = dmarc?.status?.result === "fail";
          if (dmarcFail && dmarc?.policy === "reject") return done(smtpError(550, "Rejected: the sender's domain says this message is forged (DMARC)"));
          const spfFail = auth.spf && auth.spf.status.result === "fail";

          const m = await simpleParser(raw);
          const to = session.envelope.rcptTo.map((r) => r.address.toLowerCase());
          const from = addressesOf(m.from)[0] ?? mailFrom;
          const result = await handOff({
            to, from: from || "unknown@invalid", fromName: m.from?.value[0]?.name || undefined, cc: addressesOf(m.cc),
            subject: m.subject ?? "", text: m.text ?? "", html: typeof m.html === "string" ? m.html : undefined,
            messageId: m.messageId ?? `<${Date.now()}.${Math.random().toString(36).slice(2)}@${config.MAIL_HOST}>`,
            inReplyTo: typeof m.inReplyTo === "string" ? m.inReplyTo : undefined,
            spam: dmarcFail || !!spfFail,
            attachments: m.attachments.map((a) => ({ filename: a.filename || "attachment", contentType: a.contentType || "application/octet-stream", data: a.content.toString("base64") })),
          });
          log("received", { from, to, delivered: result.delivered.length, spam: dmarcFail || !!spfFail });
          if (!result.delivered.length) return done(smtpError(result.full.length ? 452 : 550, result.full.length ? "Mailbox storage is full" : "No such user here"));
          done(null, "Queued for delivery");
        } catch (err) {
          log("receive failed", { error: (err as Error).message });
          done(smtpError(451, "Temporary problem, please try again later"));
        }
      });
    },
  });
}
