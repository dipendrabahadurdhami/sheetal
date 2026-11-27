// "Try the demo" route and job (FRONTEND-KIT.md section 8; roadmap stage 1.2).
// Where it fits: registered in business/backend/src/app.ts under /v1 (a new route file does nothing until app.ts registers it). The business panel's
// "Try the demo" button calls it when nobody is signed in.
// How it works: POST /v1/demo/session { type, captcha? } makes a throw-away business (service.ts) and answers the sign-in token. Limits: 5 per hour per
// address, and the robot check when the super admin has switched it on (the same Turnstile settings sign-up uses).
// Rules: no sign-in needed. The answer never carries anything but the token, the business id and when it ends. What the demo may change is fenced in
// platform/src/demo/guard.ts; the cleanup job deletes it after 24 hours.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { checkCaptcha } from "@sheetal/backend-core/lib/captcha";
import { Vault } from "@sheetal/platform/auth/vault";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import type { JobSpec } from "@sheetal/platform/jobs/registry";
import { DEMO_HOURS, DEMO_TYPES, cleanupDemos, startDemo } from "./service.js";

/** What a demo visitor may change on the business API: the pages on the screen kit (Expenses without file uploads, review replies) and the bell. */
export const DEMO_ALLOW: readonly RegExp[] = [
  /^\/v1\/demo\/session$/,
  /^\/v1\/expenses(\/[\w-]+)?$/,
  /^\/v1\/expenses\/[\w-]+\/confirm$/,
  /^\/v1\/expenses\/recurring(\/[\w-]+)?$/,
  /^\/v1\/expenses\/recurring\/[\w-]+\/(pause|resume|stop)$/,
  /^\/v1\/reviews\/[\w-]+\/reply$/,
  /^\/v1\/notifications(\/[\w-]+)*$/,
];

const Body = z.object({ type: z.enum(DEMO_TYPES).default("agency"), captcha: z.string().max(4096).optional() }).strict();

export async function demoRoutes(app: FastifyInstance, opts: { fetch?: Fetch } = {}) {
  app.post("/demo/session", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request) => {
    // Demos are given by Sheetal's team after a demo request (website /technology#demo); the self-serve button is off unless switched on.
    if (!app.config.DEMO_SELF_SERVE) return { status: 403, message: "Demos are given by our team. Request one at sheetalproperty.com/technology and we will call you." };
    const b = Body.parse(request.body ?? {});
    const db = dbOf(app);
    await checkCaptcha({ db, vault: new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production"), token: b.captcha, ip: request.ip, fetch: opts.fetch });
    const demo = await startDemo(app as never, { type: b.type, request });
    return { status: 201, message: `Your demo is ready. It is deleted after ${DEMO_HOURS} hours.`, data: { token: demo.token, tenantId: demo.tenantId, expiresAt: demo.expiresAt } };
  });
}

export const DEMO_CLEANUP_EVERY_MS = 60 * 60_000;
export const DEMO_CLEANUP_FIRST_RUN_MS = 120_000;

/** The hourly cleanup of demo businesses whose 24 hours are over. */
export function demoCleanupJob(app: FastifyInstance): JobSpec {
  return {
    id: "demo.cleanup", everyMs: DEMO_CLEANUP_EVERY_MS, firstRunMs: DEMO_CLEANUP_FIRST_RUN_MS, failMessage: "demo cleanup failed",
    run: async () => {
      const n = await cleanupDemos(dbOf(app), new Date(), app.log);
      if (n) app.log.info({ deleted: n }, "demo businesses deleted");
    },
  };
}
