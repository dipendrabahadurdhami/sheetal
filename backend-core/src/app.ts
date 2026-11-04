// Base Fastify app shared by the website, business and admin APIs.
// Where it fits: each API's src/app.ts calls buildBaseApp() and then registers its own routes on top.
// How it works: adds logging (secrets redacted), request ids, the single error format, security headers, CORS,
// rate limits, form parsing, login sessions, the email outbox and /health. Nothing listens here, so tests can
// call the app directly with app.inject().
// Rules: every API must be built through this function so security and error handling stay the same everywhere.

import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { createCache, type Cache } from "./lib/cache.js";
import { createDb, type Db } from "./lib/db.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.js";
import { Mailer } from "./lib/mailer.js";
import { registerAuth } from "./modules/auth/sessions.js";
import { configureStorage } from "./lib/storage.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
    db?: Db;
    cache: Cache;
    mailer: Mailer;
  }
}

export interface AppDeps { db?: Db; cache?: Cache }

export async function buildBaseApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.LOG_LEVEL === "silent" ? false : {
      level: config.LOG_LEVEL,
      redact: { paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token", "*.secret"], censor: "[hidden]" },
      ...(config.NODE_ENV === "development" ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } } : {}),
    },
    trustProxy: config.TRUST_PROXY,
    // Keep the caller's request id (from the load balancer) or make one; it's returned on every response and in every error.
    genReqId: (req) => (typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].length <= 100 ? req.headers["x-request-id"] : randomUUID()),
    bodyLimit: 1_000_000,
  });

  app.decorate("config", config);
  configureStorage(config); // photos also go to object storage when S3_BUCKET is set (lib/storage.ts)
  app.decorate("db", deps.db ?? createDb(config.DATABASE_URL, config.LOG_LEVEL === "debug"));
  app.decorate("cache", deps.cache ?? createCache(config.REDIS_URL));
  app.decorate("mailer", new Mailer(app.db, app.log, config.NODE_ENV !== "production"));

  app.addHook("onSend", async (request, reply) => { reply.header("x-request-id", request.id); });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } });
  // Every method the panels use; the browser blocks the rest (the default is only GET, HEAD and POST).
  await app.register(cors, { origin: config.CORS_ORIGINS, credentials: true, maxAge: 86400, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] });
  await app.register(rateLimit, { max: config.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" });
  // Website forms send FormData; text fields arrive as a plain object. Files are handled by the files module.
  await app.register(multipart, { attachFieldsToBody: "keyValues", limits: { fileSize: 20 * 1024 * 1024, files: 21 } });
  registerAuth(app);

  await app.register(healthRoutes);

  app.addHook("onClose", async () => {
    await app.db?.$disconnect();
    await app.cache.close();
  });
  return app;
}
