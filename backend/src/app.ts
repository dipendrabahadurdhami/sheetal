import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { createCache, type Cache } from "./lib/cache.js";
import { createDb, type Db } from "./lib/db.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
    db?: Db;
    cache: Cache;
  }
}

export interface AppDeps { db?: Db; cache?: Cache }

// Builds the API without starting it, so tests can call it directly.
export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
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
  app.decorate("db", deps.db ?? createDb(config.DATABASE_URL, config.LOG_LEVEL === "debug"));
  app.decorate("cache", deps.cache ?? createCache(config.REDIS_URL));

  app.addHook("onSend", async (request, reply) => { reply.header("x-request-id", request.id); });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } });
  await app.register(cors, { origin: config.CORS_ORIGINS, credentials: true, maxAge: 86400 });
  await app.register(rateLimit, { max: config.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" });

  await app.register(healthRoutes);
  // Feature modules register under /v1 as they are built: await app.register(authRoutes, { prefix: "/v1" }) …

  app.addHook("onClose", async () => {
    await app.db?.$disconnect();
    await app.cache.close();
  });
  return app;
}
