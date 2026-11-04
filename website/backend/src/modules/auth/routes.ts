// Accounts on the website: sign up, sign in, confirm email, forgot and reset password, profile, change password.
// Where it fits: the website's sign-in screens (website/frontend/src/api/endpoints.js); the panels reuse the same token.
// How it works: passwords are hashed (Argon2id); sign-in gives a session token; email links carry one-time tokens.
// Rules: five wrong passwords lock the account for a while; people from the old site must set a new password first;
// replies never say whether an email has an account.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, conflict } from "@sheetal/backend-core/lib/errors";
import { emails } from "@sheetal/backend-core/lib/mailer";
import { checkPassword, hashPassword, newToken, sha256 } from "@sheetal/backend-core/lib/secrets";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { userJson } from "@sheetal/backend-core/modules/auth/present";
import { createSession, requireUser, revokeAllSessions, revokeSession, userForToken } from "@sheetal/backend-core/modules/auth/sessions";

const email = z.email("Enter a valid email address.").transform((s) => s.trim().toLowerCase());
const password = z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters.");
const name = z.string().trim().min(2, "Enter your name.").max(60);

const VERIFY_HOURS = 48;
const RESET_HOURS = 1;
const MAX_FAILS = 5;           // wrong passwords per email…
const FAIL_WINDOW = 15 * 60;   // …within 15 minutes, then a pause

const strict = (max: number) => ({ config: { rateLimit: { max, timeWindow: "1 minute" } } });

export async function authRoutes(app: FastifyInstance) {
  const db = () => {
    if (!app.db) throw new AppError(503, "unavailable", "The service is starting up. Please try again in a minute.");
    return app.db;
  };
  const audit = (request: { ip: string }, action: string, actorId?: string, meta?: object) =>
    db().auditLog.create({ data: { action, actorId, ip: request.ip, meta: meta as object | undefined } });

  async function emailLink(userId: string, purpose: "verify_email" | "reset_password") {
    const token = newToken();
    const hours = purpose === "verify_email" ? VERIFY_HOURS : RESET_HOURS;
    await db().emailToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600e3) } });
    const base = app.config.SITE_URL.replace(/\/$/, "");
    return purpose === "verify_email" ? `${base}/verify-email?token=${token}` : `${base}/reset-password/${token}`;
  }

  async function useToken(token: string, purpose: "verify_email" | "reset_password") {
    const row = await db().emailToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) {
      throw new AppError(400, "link_invalid", "This link has expired or was already used. Please ask for a new one.");
    }
    await db().emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row.user;
  }

  app.post("/login", strict(10), async (request) => {
    const body = z.object({ email, password: z.string().min(1, "Enter your password.") }).parse(request.body);
    const failKey = `login-fail:${body.email}`;
    const fails = (await app.cache.get<number>(failKey)) ?? 0;
    if (fails >= MAX_FAILS) throw new AppError(429, "locked", "Too many wrong passwords. Please wait 15 minutes or reset your password.");

    const user = await db().user.findUnique({ where: { email: body.email } });
    if (user && !user.passwordHash) {
      // Imported from the old site: they set a new password through their email first.
      await app.mailer.send(emails.welcomeBack(user.email, user.userName, await emailLink(user.id, "reset_password")));
      throw new AppError(403, "password_reset_required", `Welcome to the new Sheetal Property. We sent a link to ${user.email} to set your new password.`);
    }
    if (!user || !(await checkPassword(user.passwordHash, body.password))) {
      await app.cache.set(failKey, fails + 1, FAIL_WINDOW);
      throw new AppError(401, "wrong_login", "Wrong email or password.");
    }
    if (user.status !== "active") throw new AppError(403, "suspended", "This account is suspended. Please contact Sheetal support.");

    await app.cache.del(failKey);
    const token = await createSession(app, user.id, request);
    const found = await userForToken(app, token);
    await audit(request, "login", user.id);
    return { status: 200, data: { ...userJson(found!.user), token } };
  });

  app.post("/register", strict(5), async (request) => {
    const body = z.object({
      user_name: name, email, password,
      password_confirmation: z.string(),
      user_type: z.string().trim().max(30).optional(),
    }).refine((b) => b.password === b.password_confirmation, { path: ["password_confirmation"], message: "Passwords do not match." }).parse(request.body);

    if (await db().user.findUnique({ where: { email: body.email } })) throw conflict("This email is already registered. Log in or reset your password.");
    const user = await db().$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: body.email, userName: body.user_name, passwordHash: await hashPassword(body.password), userType: (body.user_type || "user").toLowerCase() } });
      await createWorkspace(tx, { ownerId: u.id, name: body.user_name, type: "agency", email: body.email });
      return u;
    });
    await app.mailer.send(emails.verify(user.email, user.userName, await emailLink(user.id, "verify_email")));
    await audit(request, "register", user.id);
    return { status: 200, message: "Account created. Check your email to confirm your address, then log in." };
  });

  app.get("/email/verify/:token", strict(20), async (request) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(request.params);
    const user = await useToken(token, "verify_email");
    await db().user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
    const session = await createSession(app, user.id, request);
    await audit(request, "email_verified", user.id);
    return { status: 200, message: "Email verified. You are logged in.", token: session, user_name: user.userName };
  });

  app.post("/email/resend", strict(3), async (request) => {
    const body = z.object({ email }).parse(request.body);
    const user = await db().user.findUnique({ where: { email: body.email } });
    if (user && !user.emailVerifiedAt) await app.mailer.send(emails.verify(user.email, user.userName, await emailLink(user.id, "verify_email")));
    return { status: 200, message: "If that account needs confirming, we've sent a new link." };
  });

  app.post("/forgot-password", strict(5), async (request) => {
    const body = z.object({ email }).parse(request.body);
    const user = await db().user.findUnique({ where: { email: body.email } });
    if (user && user.status === "active") await app.mailer.send(emails.reset(user.email, user.userName, await emailLink(user.id, "reset_password")));
    // Same answer either way, so nobody can find out which emails have accounts.
    return { status: 200, message: "If the email has an account, a reset link is on its way." };
  });

  app.post("/reset-password", strict(10), async (request) => {
    const body = z.object({ token: z.string().min(10), email, password, password_confirmation: z.string() })
      .refine((b) => b.password === b.password_confirmation, { path: ["password_confirmation"], message: "Passwords do not match." }).parse(request.body);
    const user = await useToken(body.token, "reset_password");
    if (user.email !== body.email) throw new AppError(400, "link_invalid", "This link is for a different email address.");
    await db().user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.password), emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
    await revokeAllSessions(app, user.id);
    await audit(request, "password_reset", user.id);
    return { status: 200, message: "Your password has been reset. Please log in." };
  });

  app.get("/user-info", async (request) => ({ status: 200, data: userJson(requireUser(request)) }));

  app.post("/update-profile", async (request) => {
    const me = requireUser(request);
    const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === "" ? null : v));
    const body = z.object({ user_name: name.optional(), first_name: opt(60), last_name: opt(60), phone: opt(30), address: opt(200) }).parse(request.body ?? {});
    // Profile photos are stored by the files module (next phase); other fields are saved now.
    await db().user.update({ where: { id: me.id }, data: { userName: body.user_name, firstName: body.first_name, lastName: body.last_name, phone: body.phone, address: body.address } });
    const fresh = await userForToken(app, request.headers.authorization!.slice(7).trim());
    return { status: 200, message: "Profile updated", data: userJson(fresh!.user) };
  });

  app.post("/change-password", strict(10), async (request) => {
    const me = requireUser(request);
    const body = z.object({ current_password: z.string().min(1, "Enter your current password."), new_password: password, new_password_confirmation: z.string().optional() })
      .refine((b) => b.new_password_confirmation === undefined || b.new_password === b.new_password_confirmation, { path: ["new_password_confirmation"], message: "Passwords do not match." })
      .parse(request.body);
    if (!(await checkPassword(me.passwordHash, body.current_password))) throw new AppError(422, "validation", "Current password is not correct.", { current_password: ["Current password is not correct."] });
    await db().user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(body.new_password) } });
    await revokeAllSessions(app, me.id, request.sessionHash ?? undefined);
    await audit(request, "password_changed", me.id);
    return { status: 200, message: "Password changed. Other devices were logged out." };
  });

  app.post("/logout", async (request) => {
    requireUser(request);
    await revokeSession(app, request.sessionHash!);
    return { status: 200, message: "You are logged out." };
  });
}
