import { z } from "zod";

// Every setting the API reads from the environment, checked once at start-up.
// Secrets for outside services (Cloudflare, Meta, AI…) are not here: they live encrypted in the database,
// entered in Admin → Setup center.
const list = z.string().transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SITE_URL: z.url().default("https://sheetalproperty.com"),
  API_URL: z.url().default("https://api.sheetalproperty.com"),
  // Browser origins allowed to call the API (website, business and admin apps).
  CORS_ORIGINS: list.default(["http://localhost:5173", "https://sheetalproperty.com", "https://business.sheetalproperty.com"]),
  TRUST_PROXY: z.stringbool().default(false),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  // Requests per minute per IP for the whole API; sensitive routes set lower limits.
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === "production" && !config.DATABASE_URL) throw new Error("Invalid configuration: DATABASE_URL is required in production");
  return config;
}
