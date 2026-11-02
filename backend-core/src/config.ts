import { fileURLToPath } from "node:url";
import { z } from "zod";

// Every setting the APIs read from the environment, checked once at start-up.
// There are three APIs (website, business, admin), one database. Each listens on its own port:
// WEBSITE_API_PORT (4000), BUSINESS_API_PORT (4001), ADMIN_API_PORT (4002).
// Secrets for outside services (Cloudflare, Meta, AI…) are not here: they live encrypted in the database,
// entered in Admin → Setup center.
const list = z.string().transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  SERVICE: z.enum(["website", "business", "admin"]).default("website"),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SITE_URL: z.url().default("https://sheetalproperty.com"),
  API_URL: z.url().default("https://api.sheetalproperty.com"),
  // Browser origins allowed to call the API (website, business and admin apps).
  CORS_ORIGINS: list.default(["http://localhost:5173", "https://sheetalproperty.com", "https://business.sheetalproperty.com"]),
  TRUST_PROXY: z.stringbool().default(false),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  // Folder holding property photos as property/<main|thumbnail|original>/<file>. Set locally (the old site's
  // public/images folder); in production photos come from object storage at MEDIA_URL instead.
  MEDIA_DIR: z.string().optional(),
  // Public address of the photos; defaults to this API's /media.
  MEDIA_URL: z.url().optional(),
  // Key that encrypts secrets stored in the database (src/lib/vault.ts). Required in production.
  SECRETS_KEY: z.string().min(32).optional(),
  // Mail: the host name of Sheetal's mail server (the MX every business domain points to), and the shared
  // secret the mail server uses to hand incoming mail to the business API.
  MAIL_HOST: z.string().default("mail.sheetalproperty.com"),
  MAIL_INBOUND_SECRET: z.string().min(24).optional(),
  // Where requests for Sheetal's team go (plan upgrades, reports).
  SUPPORT_EMAIL: z.email().default("support@sheetalproperty.com"),
  // Requests per minute per IP for the whole API; sensitive routes set lower limits.
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
});

export type Config = z.infer<typeof schema>;

export type Service = Config["SERVICE"];
const DEFAULT_PORTS: Record<Service, number> = { website: 4000, business: 4001, admin: 4002 };

export function loadConfig(env: NodeJS.ProcessEnv = process.env, service: Service = "website"): Config {
  const port = env[`${service.toUpperCase()}_API_PORT`] ?? String(DEFAULT_PORTS[service]);
  const parsed = schema.safeParse({ ...env, SERVICE: service, PORT: port });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === "production" && !config.DATABASE_URL) throw new Error("Invalid configuration: DATABASE_URL is required in production");
  if (config.NODE_ENV === "production" && !config.SECRETS_KEY) throw new Error("Invalid configuration: SECRETS_KEY is required in production");
  return config;
}

/** Reads the app's own .env (if any), then backend-core/.env for the shared settings such as DATABASE_URL.
 *  Values already in the real environment always win. */
export function loadEnvFiles() {
  for (const file of [".env", fileURLToPath(new URL("../.env", import.meta.url))]) {
    try { process.loadEnvFile(file); } catch { /* no such file */ }
  }
}
