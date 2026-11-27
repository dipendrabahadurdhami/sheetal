// Accounts on the website: sign up, sign in, confirm email, forgot and reset password, profile, change password.
// Where it fits: the website's sign-in screens (website/frontend/src/api/endpoints.js); the panels reuse the same token.
// How it works: passwords are hashed (Argon2id); sign-in gives a session token; email links carry one-time tokens.
// Rules: five wrong passwords lock the account for a while; people from the old site must set a new password first;
// replies never say whether an email has an account.

import type { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { AppError, conflict } from "@sheetal/platform/core/errors";
import { emails } from "@sheetal/backend-core/lib/mailer";
import { checkPassword, hashPassword, newToken, sha256 } from "@sheetal/platform/auth/secrets";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { userJson } from "@sheetal/backend-core/modules/auth/present";
import { platformSettings } from "@sheetal/backend-core/domain/platform";
import { createSession, requireUser, revokeAllSessions, revokeSession, userForToken } from "@sheetal/backend-core/modules/auth/sessions";

const email = z.email("Enter a valid email address.").transform((s) => s.trim().toLowerCase());
const password = z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters.");
const name = z.string().trim().min(2, "Enter your name.").max(60);

const VERIFY_HOURS = 48;
const RESET_HOURS = 1;
const MAX_FAILS = 5;           // wrong passwords per email (Admin → Settings → Security can change it; 0 = off)…
const FAIL_WINDOW = 15 * 60;   // …within 15 minutes, then a pause

const CODE_MINUTES = 10;       // a sign-in code works this long…
const CODE_TRIES = 5;          // …for this many wrong tries
/** "ram@gmail.com" → "r**@gmail.com": shows where the code went without spelling out the address. */
const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_m, a: string, b: string, c: string) => `${a}${"*".repeat(Math.min(Math.max(b.length, 2), 6))}${c}`);
interface PendingLogin { userId: string; email: string; codeHash: string; tries: number; sends: number }

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
    const max = await platformSettings(db()).then((p) => p.maxLoginAttempts).catch(() => MAX_FAILS);
    if (max > 0 && fails >= max) throw new AppError(429, "locked", "Too many tries. Wait 15 minutes or reset your password.");

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
    // Sign-in code (Admin → Settings → Security, on by default): the password was right; now a 6-digit code goes to the email and the
    // sign-in is made only when it is typed (POST /login/code). The ticket names this half-done sign-in for 10 minutes.
    const codeOn = await platformSettings(db()).then((p) => p.loginCode !== false).catch(() => true);
    if (codeOn) {
      const ticket = newToken();
      await sendLoginCode(ticket, { userId: user.id, email: user.email, codeHash: "", tries: 0, sends: 0 }, user.userName);
      await audit(request, "login_code_sent", user.id);
      return { status: 200, otp_required: true, ticket, sent_to: maskEmail(user.email), minutes: CODE_MINUTES, message: `We sent a 6-digit code to ${maskEmail(user.email)}.` };
    }
    return signedIn(request, user.id, "login");
  });

  /** Makes the session and answers like a sign-in always has. */
  async function signedIn(request: Parameters<typeof createSession>[2], userId: string, action: string) {
    const token = await createSession(app, userId, request);
    const found = await userForToken(app, token);
    await audit(request as { ip: string }, action, userId);
    return { status: 200, data: { ...userJson(found!.user), token } };
  }

  /** A new code for a half-done sign-in: saved hashed with the ticket, sent by email (the code also in the subject, so phones offer it). */
  async function sendLoginCode(ticket: string, p: PendingLogin, userName: string) {
    if (p.sends >= 5) throw new AppError(429, "too_many_codes", "Too many codes. Please start the sign-in again in a few minutes.");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await app.cache.set(`login-code:${sha256(ticket)}`, { ...p, codeHash: sha256(`${ticket}:${code}`), tries: 0, sends: p.sends + 1 }, CODE_MINUTES * 60);
    await app.mailer.send({
      to: p.email,
      subject: `${code} is your Sheetal sign-in code`,
      text: [`Hello ${userName || ""},`.trim(), "", `Your Sheetal sign-in code is: ${code}`, "", `It works for ${CODE_MINUTES} minutes. If you did not try to sign in, change your password: someone knows it.`, "", "Sheetal Property · Sheetal Business"].join("\n"),
    });
  }

  app.post("/login/code", strict(15), async (request) => {
    const b = z.object({ ticket: z.string().min(20).max(200), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") }).parse(request.body);
    const key = `login-code:${sha256(b.ticket)}`;
    const p = await app.cache.get<PendingLogin>(key);
    if (!p) throw new AppError(400, "code_expired", "This code has expired. Please sign in again.");
    if (sha256(`${b.ticket}:${b.code}`) !== p.codeHash) {
      const tries = p.tries + 1;
      if (tries >= CODE_TRIES) { await app.cache.del(key); throw new AppError(400, "code_expired", "Too many wrong codes. Please sign in again."); }
      await app.cache.set(key, { ...p, tries }, CODE_MINUTES * 60);
      throw new AppError(400, "wrong_code", `That code is not right. ${CODE_TRIES - tries} tries left.`, { code: ["Wrong code."] });
    }
    await app.cache.del(key);
    const user = await db().user.findUnique({ where: { id: p.userId } });
    if (!user || user.status !== "active") throw new AppError(403, "suspended", "This account is suspended. Please contact Sheetal support.");
    // Typing the code proves the email is theirs.
    if (!user.emailVerifiedAt) await db().user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    return signedIn(request, user.id, "login");
  });

  app.post("/login/code/resend", strict(3), async (request) => {
    const b = z.object({ ticket: z.string().min(20).max(200) }).parse(request.body);
    const p = await app.cache.get<PendingLogin>(`login-code:${sha256(b.ticket)}`);
    if (!p) throw new AppError(400, "code_expired", "This sign-in has expired. Please sign in again.");
    const user = await db().user.findUnique({ where: { id: p.userId }, select: { userName: true } });
    await sendLoginCode(b.ticket, p, user?.userName ?? "");
    return { status: 200, message: `A new code is on its way to ${maskEmail(p.email)}.` };
  });

  app.post("/register", strict(5), async (request) => {
    const body = z.object({
      user_name: name, email, password,
      password_confirmation: z.string(),
      user_type: z.string().trim().max(30).optional(),
      // From the business panel's sign-up (plans first): the business to make, its type and a phone number.
      business_name: z.string().trim().min(2, "Enter your business name.").max(80).optional(),
      business_type: z.enum(["agency", "hotel", "host", "developer", "sponsor"]).optional(),
      phone: z.string().trim().max(20).regex(/^[+\d\s-]*$/, "Use digits only.").optional(),
    }).refine((b) => b.password === b.password_confirmation, { path: ["password_confirmation"], message: "Passwords do not match." }).parse(request.body);

    if (await db().user.findUnique({ where: { email: body.email } })) throw conflict("This email is already registered. Log in or reset your password.");
    const { trialDays } = await platformSettings(db());
    const user = await db().$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: body.email, userName: body.user_name, passwordHash: await hashPassword(body.password), userType: (body.user_type || "user").toLowerCase(), phone: body.phone || null } });
      await createWorkspace(tx, { ownerId: u.id, name: body.business_name || body.user_name, type: body.business_type || "agency", email: body.email, phone: body.phone || undefined, trialDays, startOnApps: true });
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
