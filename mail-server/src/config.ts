// Settings for the mail server, read once at start-up.
// Where it fits: server.ts and the tests.
// How it works: shared settings (DATABASE_URL, SECRETS_KEY, MAIL_HOST, MAIL_INBOUND_SECRET) come from backend-core/.env
// like the APIs; the rest are the mail server's own (ports, TLS, sending pace, system email mode).
// Rules: production needs the database, SECRETS_KEY, the inbound secret and a TLS certificate.

import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().optional(),
  SECRETS_KEY: z.string().min(32).optional(),
  /** This server's own name, as other mail servers see it (the MX of every business domain, and the reverse DNS of its IP). */
  MAIL_HOST: z.string().default("mail.sheetalproperty.com"),
  /** The business API that stores incoming mail. */
  BUSINESS_API_URL: z.url().default("http://localhost:4001/v1"),
  MAIL_INBOUND_SECRET: z.string().min(24).optional(),

  // Receiving: port 25 on the server; a different port locally.
  SMTP_BIND: z.string().default("0.0.0.0"),
  SMTP_PORT: z.coerce.number().int().positive().default(25),
  /** TLS certificate for STARTTLS (e.g. Let's Encrypt for MAIL_HOST). Without it mail still arrives, unencrypted. */
  TLS_KEY_PATH: z.string().optional(),
  TLS_CERT_PATH: z.string().optional(),
  MAX_MESSAGE_MB: z.coerce.number().int().positive().max(50).default(40),

  // Sending
  /** Port other servers receive on. Always 25 on the internet; tests point it at a local fake server. */
  OUTBOUND_PORT: z.coerce.number().int().positive().default(25),
  /** Seconds between looks at the queue. */
  OUTBOUND_EVERY: z.coerce.number().int().positive().default(10),
  OUTBOUND_BATCH: z.coerce.number().int().positive().max(200).default(20),

  // System emails (verify, reset, invites, invoices, reminders) from the outbox
  /** Who they come from. Its domain must be added in business email (Domain and email) so they are DKIM-signed. */
  SYSTEM_MAIL_FROM: z.string().default("Sheetal Property <no-reply@sheetalproperty.com>"),
  /** direct = to each recipient's mail server (production); relay = through SMTP_RELAY_URL; file = saved as .eml files
   *  in MAIL_DROP_DIR and not sent (development default). */
  SYSTEM_MAIL_MODE: z.enum(["direct", "relay", "file"]).optional(),
  /** e.g. smtp://user:password@smtp.example.com:587 (only for relay mode). */
  SMTP_RELAY_URL: z.string().optional(),
  MAIL_DROP_DIR: z.string().default("mail-outbox"),
});

export type MailConfig = Omit<z.infer<typeof schema>, "SYSTEM_MAIL_MODE"> & { SYSTEM_MAIL_MODE: "direct" | "relay" | "file" };

export function loadMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const c = { ...parsed.data, SYSTEM_MAIL_MODE: parsed.data.SYSTEM_MAIL_MODE ?? (parsed.data.NODE_ENV === "production" ? "direct" : "file") };
  if (c.SYSTEM_MAIL_MODE === "relay" && !c.SMTP_RELAY_URL) throw new Error("Invalid configuration: SMTP_RELAY_URL is required for SYSTEM_MAIL_MODE=relay");
  if (c.NODE_ENV === "production") {
    for (const k of ["DATABASE_URL", "SECRETS_KEY", "MAIL_INBOUND_SECRET", "TLS_KEY_PATH", "TLS_CERT_PATH"] as const) {
      if (!c[k]) throw new Error(`Invalid configuration: ${k} is required in production`);
    }
  }
  return c;
}
