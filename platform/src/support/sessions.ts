// Support sessions ("log in as a business", ACCESS.md section 12): start, find, and end. No HTTP in this file.
// Where it fits: the admin API's /admin/businesses/:id/impersonate routes call startSupportSession() and endSupportSession(); the business API's
// support hook (support/hooks.ts) calls resolveSupportSession() on every request that carries a support token.
// How it works:
//   start   needs platform.business.impersonate and a FRESH sign-in (the password is sent again in the request), a reason of 10 to 300 characters, and a length of
//           1 to 30 minutes (default 15). Read-only unless write mode is asked for: that needs platform.business.impersonate_write (super admin), a second typed
//           reason, and a business that is not suspended. It writes the ImpersonationSession row and the audit rows "impersonation.started" (platform log and the
//           business's log, both with the business name), tells the owners (in-app note + email), and hands back the token (auth/support-token.ts).
//   resolve finds the open session behind a token: not ended, not expired, the staff member still active with a platform role. An expired one is closed on the spot.
//   end     closes it once (a compare-and-set on endedAt) and writes "impersonation.ended" to both logs with the number of requests it made.
// Rules: a support session never counts as a seat; it cannot open a business whose owners are all Sheetal staff; one open session per staff member (starting a new
// one ends the old one). The token is never stored or logged. Reasons and the business name are copied into the audit rows, so the trail survives the business.

import type { Prisma } from "@prisma/client";
import { AppError, badRequest, forbidden, notFound } from "../core/errors.js";
import type { StaffContext } from "../core/context.js";
import type { Db } from "../db/client.js";
import { checkPassword } from "../auth/secrets.js";
import { signSupportToken, readSupportToken } from "../auth/support-token.js";
import { notify } from "../notify/index.js";

export const SUPPORT_DEFAULT_MINUTES = 15;
export const SUPPORT_MAX_MINUTES = 30;

export interface StartSupportInput {
  /** The staff member's password, typed again for this session (a fresh sign-in). */
  password: string;
  /** 10 to 300 characters; a ticket number is welcome. */
  reason: string;
  minutes?: number;
  /** Write mode. Needs platform.business.impersonate_write, a second reason in `writeReason`, and a business that is not suspended. */
  write?: boolean;
  writeReason?: string;
}

export interface SupportMailer { send(m: { to: string; subject: string; text: string }): Promise<unknown> }

export interface SupportSessionView {
  id: string; staffId: string; tenantId: string; reason: string; startedAt: Date; expiresAt: Date; readOnly: boolean; requestCount: number;
  business: { id: string; name: string };
  staff: { id: string; userName: string; email: string | null; platformRole: string };
}

const text = (s: string | undefined, label: string): string => {
  const t = (s ?? "").trim();
  if (t.length < 10 || t.length > 300) throw badRequest(`Give ${label} of 10 to 300 characters.`);
  return t;
};

export function minutesFor(asked: number | undefined): number {
  return Math.min(Math.max(Math.trunc(asked ?? SUPPORT_DEFAULT_MINUTES), 1), SUPPORT_MAX_MINUTES);
}

export async function startSupportSession(o: {
  db: Db; staff: StaffContext; tenantId: string; input: StartSupportInput; secret: string | undefined; mailer?: SupportMailer; now?: Date;
}): Promise<{ token: string; session: { id: string; tenantId: string; business: string; reason: string; expiresAt: Date; readOnly: boolean; minutes: number } }> {
  const { db, staff, input } = o;
  const now = o.now ?? new Date();
  staff.permissions.require("platform.business.impersonate", "Your staff role can't open a business as support.");
  const reason = text(input.reason, "a reason");
  const write = input.write === true;
  if (write) {
    staff.permissions.require("platform.business.impersonate_write", "Only the super admin can open a business in write mode.");
    text(input.writeReason, "a second reason for write mode");
  }
  const actor = staff.actor;
  if (actor.kind !== "staff") throw forbidden("This is for Sheetal staff only.");

  // A fresh sign-in: the password again, now. (Two-step sign-in is not built yet; when it is, it is asked here too.)
  const me = await db.user.findUnique({ where: { id: actor.staffId }, select: { passwordHash: true } });
  if (!(await checkPassword(me?.passwordHash, input.password ?? ""))) throw new AppError(403, "reauth_required", "Type your password again to open a business.");

  const tenant = await db.tenant.findUnique({ where: { id: o.tenantId }, select: { id: true, name: true, status: true } });
  if (!tenant) throw notFound("Business not found.");
  if (write && tenant.status === "suspended") throw forbidden("A suspended business can only be opened read-only.");

  const owners = await db.membership.findMany({
    where: { tenantId: tenant.id, status: "active", role: { key: "owner" } },
    select: { user: { select: { id: true, email: true, platformRole: true } } },
  });
  // "Not another staff member": a workspace that only Sheetal staff own is theirs, not a customer's.
  if (owners.length > 0 && owners.every((m) => !!m.user.platformRole)) throw forbidden("That workspace belongs to Sheetal staff.");

  const minutes = minutesFor(input.minutes);
  const expiresAt = new Date(now.getTime() + minutes * 60_000);
  const meta: Prisma.InputJsonValue = { tenantId: tenant.id, businessName: tenant.name, reason, readOnly: !write, minutes, ...(write ? { writeReason: input.writeReason!.trim() } : {}) };

  const session = await db.$transaction(async (tx) => {
    // One open session per staff member.
    const open = await tx.impersonationSession.findMany({ where: { staffId: actor.staffId, endedAt: null, expiresAt: { gt: now } }, select: { id: true, tenantId: true } });
    for (const s of open) await endIn(tx as unknown as Db, { id: s.id, endedBy: actor.staffId, now, by: "replaced" });
    const row = await tx.impersonationSession.create({ data: { staffId: actor.staffId, tenantId: tenant.id, reason, expiresAt, readOnly: !write, ip: staff.ip } });
    const withId = { ...(meta as object), sessionId: row.id };
    await tx.auditLog.create({ data: { tenantId: null, actorId: actor.staffId, action: "impersonation.started", target: tenant.name, ip: staff.ip, meta: withId } });
    await tx.auditLog.create({ data: { tenantId: tenant.id, actorId: actor.staffId, action: "impersonation.started", target: tenant.name, ip: staff.ip, meta: withId } });
    return row;
  });

  // The owners are told at the START (no silent access): in the app and by email. A failed note or email never stops the session; it is logged.
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const line = `Sheetal support opened your account at ${when} for: ${reason}`;
  await notify(db, owners.map((m) => m.user.id), { type: "support_session", title: "Sheetal support opened your account", message: line, link: "/business", tenantId: tenant.id })
    .catch((err: unknown) => staff.log.warn({ err }, "support session note failed"));
  for (const m of owners) {
    if (!m.user.email || !o.mailer) continue;
    await o.mailer.send({ to: m.user.email, subject: `Sheetal support opened ${tenant.name}`, text: `${line}\n\nIt is ${write ? "a session that may make changes" : "read-only"} and ends within ${minutes} minutes. Every action is recorded in your audit log. If you did not ask for support, reply to this email.` })
      .catch((err: unknown) => staff.log.warn({ err }, "support session email failed"));
  }
  return { token: signSupportToken(o.secret, session.id), session: { id: session.id, tenantId: tenant.id, business: tenant.name, reason, expiresAt, readOnly: !write, minutes } };
}

/** Closes a session once and writes both audit rows. Returns false when it was already closed. */
async function endIn(db: Db, o: { id: string; endedBy: string; now: Date; by: "staff" | "system" | "replaced" }): Promise<boolean> {
  const row = await db.impersonationSession.findUnique({ where: { id: o.id }, include: { tenant: { select: { name: true } } } });
  if (!row) return false;
  const done = await db.impersonationSession.updateMany({ where: { id: o.id, endedAt: null }, data: { endedAt: o.now, endedBy: o.endedBy } });
  if (done.count !== 1) return false;
  const name = row.tenant?.name ?? null;
  const meta = { sessionId: row.id, tenantId: row.tenantId, businessName: name, reason: row.reason, requestCount: row.requestCount, endedBy: o.by };
  await db.auditLog.create({ data: { tenantId: null, actorId: row.staffId, action: "impersonation.ended", target: name, meta } });
  if (row.tenantId) await db.auditLog.create({ data: { tenantId: row.tenantId, actorId: row.staffId, action: "impersonation.ended", target: name, meta } });
  return true;
}

export const endSupportSession = (db: Db, o: { id: string; endedBy: string; now?: Date; by?: "staff" | "system" }) =>
  endIn(db, { id: o.id, endedBy: o.endedBy, now: o.now ?? new Date(), by: o.by ?? "staff" });

/** The open session behind a token, or null (wrong signature, ended, expired, staff gone). An expired session is closed here, so it appears ended in the log. */
export async function resolveSupportSession(db: Db, secret: string | undefined, token: string, now = new Date()): Promise<SupportSessionView | null> {
  const id = readSupportToken(secret, token);
  if (!id) return null;
  const s = await db.impersonationSession.findUnique({
    where: { id },
    include: { tenant: { select: { id: true, name: true } }, staff: { select: { id: true, userName: true, email: true, platformRole: true, status: true } } },
  });
  if (!s || s.endedAt || !s.tenant || !s.staff.platformRole) return null;
  if (s.expiresAt <= now) { await endIn(db, { id: s.id, endedBy: "system", now, by: "system" }); return null; }
  if (s.staff.status !== "active") { await endIn(db, { id: s.id, endedBy: "system", now, by: "system" }); return null; }
  return {
    id: s.id, staffId: s.staffId, tenantId: s.tenant.id, reason: s.reason, startedAt: s.startedAt, expiresAt: s.expiresAt, readOnly: s.readOnly, requestCount: s.requestCount,
    business: { id: s.tenant.id, name: s.tenant.name }, staff: { id: s.staff.id, userName: s.staff.userName, email: s.staff.email, platformRole: s.staff.platformRole },
  };
}

/** Plain page reads are counted, not logged one by one. Never throws. */
export function countRequest(db: Db, id: string): void {
  void db.impersonationSession.update({ where: { id }, data: { requestCount: { increment: 1 } } }).catch(() => undefined);
}
