// "Continue with Google": sign in or sign up with a Google account.
// Where it fits: the website's sign-in window opens GET /v1/auth/google/start; Google sends the person back to GET /v1/auth/google/callback,
// which signs them in and sends the browser to the website page /google-signin with the session token in the address fragment (the part after #).
// How it works: the Client ID and secret come from Super Admin → Setup center → Google (only when it is live and "Show Continue with Google" is On).
// A one-time "state" (kept in the cache and in a short cookie) and a PKCE code stop forged or replayed returns.
// Rules: only a Google address that Google says is verified is accepted; an existing account with the same email is signed in (the email is proven);
// Sheetal staff accounts never sign in this way; the secret is never logged or sent to the browser.

import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Vault } from "@sheetal/platform/auth/vault";
import { hashPassword } from "@sheetal/platform/auth/secrets";
import { IntegrationService, PLATFORM } from "@sheetal/platform/integrations/service";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { platformSettings } from "@sheetal/backend-core/domain/platform";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import type { Fetch } from "@sheetal/backend-core/lib/payments";

export interface GoogleSignInSettings { clientId: string; clientSecret: string }
export interface GoogleRouteOptions {
  /** The Client ID and secret when sign-in is live and switched on; null otherwise (tests swap it). */
  google?: () => Promise<GoogleSignInSettings | null>;
  fetch?: Fetch;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const COOKIE = "g_state";
const b64url = (b: Buffer) => b.toString("base64url");

/** Whether the "Continue with Google" button should show (nothing secret). */
export async function googleSignInOn(read: () => Promise<GoogleSignInSettings | null>) {
  return !!(await read().catch(() => null));
}

export function platformGoogleReader(app: FastifyInstance): () => Promise<GoogleSignInSettings | null> {
  const cfg = app.config as { SECRETS_KEY: string; NODE_ENV: string };
  return async () => {
    const env = cfg.NODE_ENV === "production" ? "production" : cfg.NODE_ENV === "test" ? "test" : "development";
    const svc = new IntegrationService({ db: app.db as never, vault: new Vault(cfg.SECRETS_KEY, cfg.NODE_ENV === "production"), env, log: app.log });
    const r = await svc.resolve(PLATFORM, "google");
    const clientId = r?.config.signInClientId, clientSecret = r?.secrets.get("signInClientSecret");
    if (!r || r.config.signIn !== "on" || !clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  };
}

export async function googleRoutes(app: FastifyInstance, opts: GoogleRouteOptions) {
  const read = opts.google ?? platformGoogleReader(app);
  const doFetch: Fetch = opts.fetch ?? fetch;
  const site = () => app.config.SITE_URL.replace(/\/$/, "");
  const callbackUrl = () => `${app.config.API_URL.replace(/\/$/, "")}/v1/auth/google/callback`;
  const secure = () => app.config.NODE_ENV === "production";
  const back = (reply: FastifyReply, what: string) => reply.redirect(`${site()}/google-signin#error=${encodeURIComponent(what)}`);
  const cookieOf = (request: FastifyRequest) => (request.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === COOKIE)?.[1];
  const clearCookie = (reply: FastifyReply) => reply.header("set-cookie", `${COOKIE}=; Path=/v1/auth/google; Max-Age=0; HttpOnly; SameSite=Lax${secure() ? "; Secure" : ""}`);

  app.get("/auth/google/start", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const g = await read().catch(() => null);
    if (!g) return back(reply, "off");
    const state = b64url(randomBytes(24)), verifier = b64url(randomBytes(32));
    await app.cache.set(`gsign:${state}`, verifier, 600);
    reply.header("set-cookie", `${COOKIE}=${state}; Path=/v1/auth/google; Max-Age=600; HttpOnly; SameSite=Lax${secure() ? "; Secure" : ""}`);
    const q = new URLSearchParams({
      client_id: g.clientId, redirect_uri: callbackUrl(), response_type: "code", scope: "openid email profile",
      state, code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", prompt: "select_account",
    });
    return reply.redirect(`${AUTH_URL}?${q.toString()}`);
  });

  app.get("/auth/google/callback", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    clearCookie(reply);
    const q = request.query as { code?: string; state?: string; error?: string };
    if (q.error) return back(reply, "cancelled");
    const g = await read().catch(() => null);
    if (!g) return back(reply, "off");
    const state = typeof q.state === "string" ? q.state : "";
    const verifier = state ? await app.cache.get<string>(`gsign:${state}`) : undefined;
    if (state) await app.cache.del(`gsign:${state}`); // one use only
    if (!state || !verifier || cookieOf(request) !== state || typeof q.code !== "string" || !q.code) return back(reply, "expired");

    let profile: { email?: string; verified?: boolean; name?: string; picture?: string };
    try {
      const res = await doFetch(TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: q.code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: callbackUrl(), grant_type: "authorization_code", code_verifier: verifier }).toString(),
      });
      const j = (await res.json().catch(() => null)) as { id_token?: string } | null;
      if (!res.ok || !j?.id_token) return back(reply, "failed");
      // The id token came straight from Google over a secure connection in answer to our own request, so it is read, not re-signed.
      const claims = JSON.parse(Buffer.from(j.id_token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
      if (claims.aud !== g.clientId || !["https://accounts.google.com", "accounts.google.com"].includes(String(claims.iss))) return back(reply, "failed");
      profile = { email: typeof claims.email === "string" ? claims.email.trim().toLowerCase() : undefined, verified: claims.email_verified === true || claims.email_verified === "true", name: typeof claims.name === "string" ? claims.name : undefined, picture: typeof claims.picture === "string" ? claims.picture : undefined };
    } catch (e) {
      app.log.warn({ err: (e as Error).message }, "google sign-in: could not complete");
      return back(reply, "failed");
    }
    if (!profile.email || !profile.verified) return back(reply, "unverified");

    const db = app.db!;
    let user = await db.user.findUnique({ where: { email: profile.email } });
    if (user?.platformRole) return back(reply, "staff");   // Sheetal staff use their own sign-in
    if (user && user.status !== "active") return back(reply, "suspended");
    if (!user) {
      const { trialDays } = await platformSettings(db);
      const userName = (profile.name || profile.email.split("@")[0]!).trim().slice(0, 60).padEnd(2, " ");
      user = await db.$transaction(async (tx) => {
        const u = await tx.user.create({ data: { email: profile.email!, userName, passwordHash: await hashPassword(b64url(randomBytes(24))), emailVerifiedAt: new Date(), photoUrl: profile.picture?.slice(0, 500), userType: "user" } });
        await createWorkspace(tx, { ownerId: u.id, name: userName, type: "agency", email: profile.email!, trialDays });
        return u;
      });
      await db.auditLog.create({ data: { action: "register", actorId: user.id, ip: request.ip, meta: { via: "google" } } });
    } else if (!user.emailVerifiedAt) {
      await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }); // Google has proven the address
    }
    const token = await createSession(app as never, user.id, request);
    await db.auditLog.create({ data: { action: "login", actorId: user.id, ip: request.ip, meta: { via: "google" } } });
    return reply.redirect(`${site()}/google-signin#token=${encodeURIComponent(token)}`);
  });
}
