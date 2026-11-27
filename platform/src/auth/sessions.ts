// Sign-in sessions: who is making a request.
// Where it fits: moved here from backend-core/src/modules/auth/sessions.ts (P1-BE-4; that file re-exports everything). Registered by the
// base app; routes call requireUser() or read request.user.
// How it works: the browser keeps a random token; the database keeps its hash; a short cache in front means most
// requests don't touch the sessions table. Each request gets the person with their active business memberships.
// Each membership also carries its branch links (P1-BE-3), so the branch scope is known without another query, and passes through
// reconcileOldNames() so a row written only the old way is never "every branch" (fail closed, P1-BE-3; unchanged here).
// Rules: removed staff and paused members lose access on their next request. A sign-in lasts sessionDays (Admin →
// Settings → Security, default 30), counted again at most once an hour while it is used.
// Differences from the old file, and only these: the app is typed by what it needs (SessionApp: db and cache), because the module
// augmentation that adds `db` and `cache` to FastifyInstance lives in backend-core; and the "sessionDays" setting is read through
// setSessionDaysReader(), because platformSettings() (backend-core/src/domain/platform.ts) has not moved. The old sessions.ts calls it.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Membership, Plan, Role, Tenant, User } from "@prisma/client";
import { unauthorized } from "../core/errors.js";
import type { Db } from "../db/client.js";
import { reconcileOldNames } from "../tenancy/branch-links.js";
import { newToken, sha256 } from "./secrets.js";

/** What the session code needs of the app: the database and the cache (backend-core adds both to FastifyInstance). */
export interface SessionCache {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: string, seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}
export type SessionApp = FastifyInstance & { db?: Db; cache: SessionCache };

/** The default; Admin → Settings → Security can change it (sessionDays). */
export const SESSION_DAYS = 7;
const CACHE_SECONDS = 60;

/** Reads the sessionDays setting. backend-core's sessions.ts registers it (platformSettings); without one the default is used. */
let readDays: ((db: Db) => Promise<number>) | null = null;
export const setSessionDaysReader = (fn: ((db: Db) => Promise<number>) | null) => { readDays = fn; daysCache = null; };
/** Whether the APIs registered the session-length setting reader (a test checks it, so the setting is never silently ignored). */
export const hasSessionDaysReader = () => readDays !== null;

// How long a sign-in lasts, from the platform settings (read at most once a minute).
let daysCache: { v: number; at: number } | null = null;
async function sessionDays(app: SessionApp) {
  if (daysCache && Date.now() - daysCache.at < 60_000) return daysCache.v;
  const v = await (readDays ? readDays(app.db!).then((d) => (d > 0 ? d : SESSION_DAYS)) : Promise.resolve(SESSION_DAYS)).catch(() => SESSION_DAYS);
  daysCache = { v, at: Date.now() };
  return v;
}
/** Tests that change the setting call this so the next session reads it. */
export const forgetSessionDays = () => { daysCache = null; };

/** One branch link of a membership, with the branch name (the names stay available for screens and old code). */
export type MemberBranchLink = { branchId: string; branch: { name: string } };
export type SessionUser = User & { memberships: (Membership & { tenant: Tenant & { plan: Plan }; role: Role; branches: MemberBranchLink[] })[] };

declare module "fastify" {
  interface FastifyRequest { user: SessionUser | null; sessionHash: string | null }
}

export async function createSession(app: SessionApp, userId: string, request: FastifyRequest): Promise<string> {
  const token = newToken();
  const days = await sessionDays(app);
  await app.db!.session.create({
    data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + days * 864e5), ip: request.ip, userAgent: request.headers["user-agent"]?.slice(0, 300) },
  });
  await app.db!.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return token;
}

const loadUser = (app: SessionApp, userId: string) => app.db!.user.findUnique({
  where: { id: userId },
  include: { memberships: { where: { status: "active" }, include: { tenant: { include: { plan: true, branches: { select: { id: true, name: true } } } }, role: true, branches: { select: { branchId: true, branch: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } } },
}).then((u) => u && { ...u, memberships: u.memberships.map((m) => reconcileOldNames(m, m.tenant.branches)) });

export async function userForToken(app: SessionApp, token: string): Promise<{ user: SessionUser; hash: string } | null> {
  const hash = sha256(token);
  const key = `sess:${hash}`;
  const cached = await app.cache.get<string>(key);
  let userId = cached;
  if (!userId) {
    const s = await app.db!.session.findUnique({ where: { tokenHash: hash } });
    if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
    userId = s.userId;
    await app.cache.set(key, userId, CACHE_SECONDS);
    // Slide the expiry at most once an hour, not on every request.
    if (Date.now() - s.lastUsedAt.getTime() > 3600e3) {
      await app.db!.session.update({ where: { id: s.id }, data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + (await sessionDays(app)) * 864e5) } });
    }
  }
  const user = await loadUser(app, userId);
  if (!user || user.status !== "active") return null;
  return { user, hash };
}

export async function revokeSession(app: SessionApp, hash: string) {
  await app.db!.session.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: new Date() } });
  await app.cache.del(`sess:${hash}`);
}

/** Log out everywhere (after a password change or reset), optionally keeping the current device. */
export async function revokeAllSessions(app: SessionApp, userId: string, keepHash?: string) {
  const open = await app.db!.session.findMany({ where: { userId, revokedAt: null }, select: { tokenHash: true } });
  const ends = open.filter((s) => s.tokenHash !== keepHash);
  await app.db!.session.updateMany({ where: { tokenHash: { in: ends.map((s) => s.tokenHash) } }, data: { revokedAt: new Date() } });
  await Promise.all(ends.map((s) => app.cache.del(`sess:${s.tokenHash}`)));
}

/** Reads `Authorization: Bearer <token>` on every request; routes call requireUser() when login is needed. */
export function registerAuth(app: SessionApp) {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionHash", null);
  app.addHook("preHandler", async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ") || !app.db) return;
    const found = await userForToken(app, header.slice(7).trim());
    if (found) { request.user = found.user; request.sessionHash = found.hash; }
  });
}

export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw unauthorized();
  return request.user;
}
