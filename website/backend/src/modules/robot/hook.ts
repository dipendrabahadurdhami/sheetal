// The robot check (Cloudflare Turnstile) on every public website form: sign-in and sign-up, forgot password, enquiries (contact an agent or
// owner, site visit, requirement, contact us), reviews, blog comments, job applications, posting a property, starting free, and the rent
// payment proof. Online forms (/forms/:slug) check it in their own route.
// Where it fits: registered in website/backend/src/app.ts before the routes; the keys are the "captcha" setting staff save in Admin → Setup
// (backend-core/src/lib/captcha.ts). GET /v1/site tells the website the public site key, and the website sends the token in the
// "x-captcha" header (or a "captcha" field).
// Rules: OFF while no keys are saved (nothing changes for anyone). /public/leads is for businesses' own websites with an API key, so it is
// never asked. A token Cloudflare can't check is refused with a "try again" message.

import type { FastifyInstance } from "fastify";
import { Vault } from "@sheetal/platform/auth/vault";
import { dbOf } from "@sheetal/platform/db/client";
import { checkCaptcha } from "@sheetal/backend-core/lib/captcha";
import type { Fetch } from "@sheetal/backend-core/lib/payments";

/** The routes that need a passed robot check (POST, under /v1). */
export const ROBOT_ROUTES = [
  "/login", "/register", "/forgot-password",
  "/contact-agent", "/contact-owner", "/schedule-tour", "/requirement-form", "/agent-requirement-form", "/contact", "/demo-request",
  "/reviews", "/blog/:id/comment", "/jobs/:slug/apply", "/post-property", "/start-free", "/rent/pay",
] as const;

export function registerRobotCheck(app: FastifyInstance, opts: { fetch?: Fetch } = {}) {
  const guarded = new Set<string>(ROBOT_ROUTES.flatMap((r) => [`/v1${r}`, `/v1/auth${r}`]));
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  app.addHook("preHandler", async (request) => {
    if (request.method !== "POST" || !guarded.has(request.routeOptions?.url ?? "")) return;
    const fromHeader = request.headers["x-captcha"];
    const fromBody = (request.body as { captcha?: unknown } | null)?.captcha;
    const token = typeof fromHeader === "string" ? fromHeader : typeof fromBody === "string" ? fromBody : null;
    await checkCaptcha({ db: dbOf(app), vault, token, ip: request.ip, fetch: opts.fetch });
  });
}
