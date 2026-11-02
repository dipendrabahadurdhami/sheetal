import type { FastifyInstance } from "fastify";
import { collectStatus } from "../lib/status.js";

const startedAt = Date.now();

// /health        — the process is running (for the load balancer).
// /health/ready  — database and cache answer; 503 if not, so traffic isn't sent to a broken instance.
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok", service: app.config.SERVICE, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) }));

  app.get("/health/ready", { config: { rateLimit: false } }, async (_request, reply) => {
    const { ok, services } = await collectStatus({ db: app.db, cache: app.cache });
    return reply.status(ok ? 200 : 503).send({ status: ok ? "ready" : "not_ready", services: services.map(({ id, state, ms }) => ({ id, state, ms })) });
  });
}
