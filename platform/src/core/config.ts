// Settings read from the environment (backend-core/.env), checked once when an API starts.
// (Moved here from backend-core/src/config.ts in P1-BE-1; the old file only re-exports this one.)
// Where it fits: loadConfig() is called by each API's server.ts and by the tests; app.config holds the result.
// How it works: a zod schema with defaults for local development; production refuses to start without the
// required values (database, site URL, SECRETS_KEY).
// Rules: add every new setting here with a default or a clear error. Keys for outside services (payments, AI,
// Meta) are not settings: they are saved encrypted in the database from the admin panel.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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
  // Object storage for photos (S3-compatible: Cloudflare R2, Backblaze B2, AWS S3). Optional: without it photos
  // stay in MEDIA_DIR. With it, every new photo size is also uploaded; set MEDIA_URL to the bucket's public address.
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Key that encrypts secrets stored in the database (platform/src/auth/vault.ts). Required in production.
  SECRETS_KEY: z.string().min(32).optional(),
  // Mail: the host name of Sheetal's mail server (the MX every business domain points to), and the shared
  // secret the mail server uses to hand incoming mail to the business API.
  MAIL_HOST: z.string().default("mail.sheetalproperty.com"),
  MAIL_INBOUND_SECRET: z.string().min(24).optional(),
  // Where requests for Sheetal's team go (plan upgrades, reports).
  SUPPORT_EMAIL: z.email().default("support@sheetalproperty.com"),
  // Where copies of applications to Sheetal's own jobs go (the Careers page shows the same address).
  HIRING_EMAIL: z.email().default("hiring@sheetalproperty.com"),
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

/** Where the owner's real settings live: backend-core/.env, found by walking up from this file to the folder that holds
 *  backend-core/package.json (so it still works if the file moves again, or runs from a bundle inside the repo). */
export function backendCoreEnvPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "backend-core", "package.json"))) return join(dir, "backend-core", ".env");
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return fileURLToPath(new URL("../../../backend-core/.env", import.meta.url)); // platform/src/core -> repo root
}

/** The .env files to read, in order: the current folder's (an app's own, if any), then backend-core/.env. */
export const envFilePaths = () => [".env", backendCoreEnvPath()];

/** Reads the app's own .env (if any), then backend-core/.env for the shared settings such as DATABASE_URL.
 *  Values already in the real environment always win. */
export function loadEnvFiles() {
  for (const file of envFilePaths()) {
    try { process.loadEnvFile(file); } catch { /* no such file */ }
  }
}
