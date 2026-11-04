// Sign-in sessions: who is making a request.
// Where it fits: registered by the base app; routes call requireUser() or read request.user.
// How it works: the browser keeps a random token; the database keeps its hash; a short cache in front means most
// requests don't touch the sessions table. Each request gets the person with their active business memberships.
// Rules: removed staff and paused members lose access on their next request.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Membership, Plan, Role, Tenant, User } from "@prisma/client";
import { newToken, sha256 } from "../../lib/secrets.js";
import { unauthorized } from "../../lib/errors.js";

export const SESSION_DAYS = 30;
const CACHE_SECONDS = 60;

export type SessionUser = User & { memberships: (Membership & { tenant: Tenant & { plan: Plan }; role: Role })[] };

declare module "fastify" {
  interface FastifyRequest { user: SessionUser | null; sessionHash: string | null }
}

export async function createSession(app: FastifyInstance, userId: string, request: FastifyRequest): Promise<string> {
  const token = newToken();
  await app.db!.session.create({
    data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5), ip: request.ip, userAgent: request.headers["user-agent"]?.slice(0, 300) },
  });
  await app.db!.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return token;
}

const loadUser = (app: FastifyInstance, userId: string) => app.db!.user.findUnique({
  where: { id: userId },
  include: { memberships: { where: { status: "active" }, include: { tenant: { include: { plan: true } }, role: true }, orderBy: { createdAt: "asc" } } },
});

export async function userForToken(app: FastifyInstance, token: string): Promise<{ user: SessionUser; hash: string } | null> {
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
      await app.db!.session.update({ where: { id: s.id }, data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5) } });
    }
  }
  const user = await loadUser(app, userId);
  if (!user || user.status !== "active") return null;
  return { user, hash };
}

export async function revokeSession(app: FastifyInstance, hash: string) {
  await app.db!.session.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: new Date() } });
  await app.cache.del(`sess:${hash}`);
}

/** Log out everywhere (after a password change or reset), optionally keeping the current device. */
export async function revokeAllSessions(app: FastifyInstance, userId: string, keepHash?: string) {
  const open = await app.db!.session.findMany({ where: { userId, revokedAt: null }, select: { tokenHash: true } });
  const ends = open.filter((s) => s.tokenHash !== keepHash);
  await app.db!.session.updateMany({ where: { tokenHash: { in: ends.map((s) => s.tokenHash) } }, data: { revokedAt: new Date() } });
  await Promise.all(ends.map((s) => app.cache.del(`sess:${s.tokenHash}`)));
}

/** Reads `Authorization: Bearer <token>` on every request; routes call requireUser() when login is needed. */
export function registerAuth(app: FastifyInstance) {
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
