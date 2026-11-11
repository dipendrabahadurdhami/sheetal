// The fence around a demo business ("Try the demo", FRONTEND-KIT.md section 8): what a demo visitor may change, and nothing else.
// Where it fits: an API calls registerDemoGuard(app, { allow }) right after the base app (so it runs after the sign-in hook and before every route).
// The business API allows the pages that are on the kit (Expenses, Reviews) and the bell; the website API allows nothing but signing out.
// How it works: a demo visitor is a real user row whose email ends with @demo.sheetal.invalid (a reserved domain that can never receive mail). For such a
// user every request that is not a plain read must match one of the `allow` patterns, or it is refused with 403 demo_only. So a demo can never send an
// invitation, an email, a WhatsApp message, start a payment, post a listing on the public website, or upload files.
// Rules: an allow-list, not a deny-list: a route added later is closed to demos until someone opens it here on purpose. Reads are not limited (a demo
// business only holds its own sample rows). Nothing here runs for a normal user.

import type { FastifyInstance } from "fastify";
import { AppError } from "../core/errors.js";

/** Reserved by RFC 2606: mail to it goes nowhere. Every demo user's email ends with it. */
export const DEMO_EMAIL_DOMAIN = "demo.sheetal.invalid";
export const DEMO_REFUSAL = "This is a demo, so this action is switched off. Create a free account to use it.";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

export const isDemoEmail = (email: string | null | undefined): boolean => !!email && email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);

/** May a demo visitor make this request? Reads always; writes only on an allowed path (the path without the query string). */
export function demoRequestAllowed(method: string, url: string, allow: readonly RegExp[]): boolean {
  if (READS.has(method.toUpperCase())) return true;
  const path = url.split("?")[0] ?? "";
  return allow.some((re) => re.test(path));
}

export function registerDemoGuard(app: FastifyInstance, o: { allow: readonly RegExp[] }) {
  app.addHook("preHandler", async (request) => {
    const user = (request as { user?: { email?: string } | null }).user;
    if (!user || !isDemoEmail(user.email)) return;
    if (!demoRequestAllowed(request.method, request.url, o.allow)) throw new AppError(403, "demo_only", DEMO_REFUSAL);
  });
}
