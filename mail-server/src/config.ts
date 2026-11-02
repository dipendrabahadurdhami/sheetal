import { z } from "zod";

// Settings for Sheetal's mail server, read once at start-up. Shared settings (DATABASE_URL, SECRETS_KEY,
// MAIL_HOST, MAIL_INBOUND_SECRET) come from backend-core/.env like the APIs; the rest are the server's own.
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
});

export type MailConfig = z.infer<typeof schema>;

export function loadMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const c = parsed.data;
  if (c.NODE_ENV === "production") {
    for (const k of ["DATABASE_URL", "SECRETS_KEY", "MAIL_INBOUND_SECRET", "TLS_KEY_PATH", "TLS_CERT_PATH"] as const) {
      if (!c[k]) throw new Error(`Invalid configuration: ${k} is required in production`);
    }
  }
  return c;
}
