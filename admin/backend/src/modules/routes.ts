// Staff console basics: businesses, plan changes and suspensions, adding a business, upgrade requests, staff, audit log.
// Where it fits: the admin panel's Businesses, Staff and Audit log pages.
// How it works: staffOf() lets only people with a platform role in and checks that role's permissions
// (PLATFORM_ROLES in backend-core/src/domain/permissions.ts); every change is written to the audit log.
// Rules: auto-renew is the super admin's alone; plan changes carry to businesses covered by that plan.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { syncCovered } from "@sheetal/backend-core/domain/billing";
import type { Prisma, TenantStatus } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import { newToken, sha256 } from "@sheetal/platform/auth/secrets";
import { requireUser, revokeAllSessions, type SessionUser } from "@sheetal/backend-core/modules/auth/sessions";
import { BUSINESS_TYPES, hasPerm, PLATFORM_ROLES } from "@sheetal/backend-core/domain/permissions";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { notify } from "@sheetal/platform/notify/index";

export interface Staff { user: SessionUser; role: string; can: (perm: string) => boolean }

export function staffOf(request: FastifyRequest, perm?: string): Staff {
  const user = requireUser(request);
  const role = user.platformRole;
  if (!role || !PLATFORM_ROLES[role]) throw forbidden("This is for Sheetal staff only.");
  const can = (p: string) => hasPerm(PLATFORM_ROLES[role]!, p);
  if (perm && !can(perm)) throw forbidden("Your staff role can't do this.");
  return { user, role, can };
}

const STATUSES = ["trial", "active", "past_due", "suspended", "cancelled", "pending_verification"] as const;

export async function adminRoutes(app: FastifyInstance) {
  const audit = (s: Staff, request: FastifyRequest, action: string, target?: string, tenantId?: string, meta?: object) =>
    dbOf(app).auditLog.create({ data: { actorId: s.user.id, tenantId, action, target, ip: request.ip, meta: meta as object | undefined } });

  app.get("/admin/me", async (request) => {
    const s = staffOf(request);
    return { data: { id: s.user.id, name: s.user.userName, email: s.user.email, role: s.role, perms: PLATFORM_ROLES[s.role] } };
  });

  // ───── Businesses ─────
  app.get("/admin/tenants", async (request) => {
    staffOf(request, "platform.business.read");
    const q = z.object({ q: z.string().trim().max(80).optional(), status: z.enum(STATUSES).optional(), type: z.string().max(20).optional(), page: z.coerce.number().int().min(1).default(1), per: z.coerce.number().int().min(1).max(500).default(50) }).parse(request.query);
    const where: Prisma.TenantWhereInput = {
      ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }, { city: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    const db = dbOf(app);
    const per = q.per;
    const [total, rows] = await Promise.all([
      db.tenant.count({ where }),
      db.tenant.findMany({
        where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * per, take: per,
        include: {
          plan: { select: { id: true, name: true, price: true } }, _count: { select: { memberships: { where: { status: "active" } } } },
          memberships: { where: { role: { key: "owner" } }, take: 1, orderBy: { createdAt: "asc" }, select: { user: { select: { userName: true, email: true } } } },
        },
      }),
    ]);
    const listings = await db.listing.groupBy({ by: ["tenantId"], where: { tenantId: { in: rows.map((t) => t.id) }, status: { in: ["published", "pending", "sold", "rented"] } }, _count: true });
    const n = new Map(listings.map((l) => [l.tenantId, l._count]));
    return {
      data: rows.map((t) => ({
        id: t.id, name: t.name, type: t.type, city: t.city, email: t.email, phone: t.phone, pan: t.pan, status: t.status, plan: t.plan, period: t.period, renewsAt: t.renewsAt,
        autoRenew: t.autoRenew, createdAt: t.createdAt, logoUrl: t.logoUrl, members: t._count.memberships, listings: n.get(t.id) ?? 0,
        owner: t.memberships[0] ? { name: t.memberships[0].user.userName, email: t.memberships[0].user.email } : null,
      })),
      meta: { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / per)), per_page: per },
    };
  });

  /** Sets up a business for its owner. Someone new gets an account and a link to set their own password. */
  app.post("/admin/tenants", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request) => {
    const s = staffOf(request, "platform.business.read+platform.business.create+platform.business.update");
    const b = z.object({
      name: z.string().trim().min(2, "Enter the business name.").max(80),
      type: z.enum(BUSINESS_TYPES),
      city: z.string().trim().max(60).optional(),
      owner: z.string().trim().min(2, "Enter the owner's name.").max(60),
      email: z.email("Enter a valid email address.").transform((x) => x.toLowerCase().trim()),
      phone: z.string().trim().max(30).optional().transform((v) => v || undefined),
      pan: z.string().trim().max(20).optional().transform((v) => v || undefined),
    }).parse(request.body);
    const db = dbOf(app);
    const existing = await db.user.findUnique({ where: { email: b.email } });
    const { tenant, user, isNew } = await db.$transaction(async (tx) => {
      const user = existing ?? await tx.user.create({ data: { email: b.email, userName: b.owner, phone: b.phone } });
      const tenant = await createWorkspace(tx, { ownerId: user.id, name: b.name, type: b.type, city: b.city, email: b.email, phone: b.phone });
      if (b.pan) await tx.tenant.update({ where: { id: tenant.id }, data: { pan: b.pan } });
      return { tenant, user, isNew: !existing };
    });
    const site = app.config.SITE_URL.replace(/\/$/, "");
    if (isNew || !user.passwordHash) {
      const token = newToken();
      await db.emailToken.create({ data: { userId: user.id, purpose: "reset_password", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 48 * 3600e3) } });
      await app.mailer.send({ to: b.email, subject: `${b.name} is ready on Sheetal Property`, text: `Namaste ${b.owner},\n\nSheetal Property has set up ${b.name} for you on the free Starter plan.\n\nSet your password within 48 hours:\n${site}/reset-password/${token}\n\nThen open your business panel at ${site}/business\n\nSheetal Property`, template: { key: "tenant_ready_new", vars: { name: b.owner, business: b.name, link: `${site}/reset-password/${token}`, site } } });
    } else {
      await app.mailer.send({ to: b.email, subject: `${b.name} is ready on Sheetal Property`, text: `Namaste ${user.userName},\n\nSheetal Property has set up ${b.name} for you on the free Starter plan. Sign in as usual and pick it in your business panel:\n${site}/business\n\nSheetal Property`, template: { key: "tenant_ready_existing", vars: { name: user.userName, business: b.name, link: `${site}/business`, site } } });
    }
    await audit(s, request, "admin.tenant_created", b.name, tenant.id, { owner: b.email });
    return { status: 200, message: `${b.name} is set up. ${b.email} has been emailed.`, data: { id: tenant.id } };
  });

  app.get<{ Params: { id: string } }>("/admin/tenants/:id", async (request) => {
    staffOf(request, "platform.business.read");
    const db = dbOf(app);
    const t = await db.tenant.findUnique({ where: { id: request.params.id }, include: { plan: true, memberships: { include: { user: { select: { id: true, userName: true, email: true, lastLoginAt: true } }, role: { select: { key: true, name: true } } } } } });
    if (!t) throw notFound("Business not found.");
    const [listings, leads, activity, upgrades] = await Promise.all([
      db.listing.groupBy({ by: ["status"], where: { tenantId: t.id }, _count: true }),
      db.lead.count({ where: { tenantId: t.id } }),
      db.auditLog.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.upgradeRequest.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    ]);
    return {
      data: {
        id: t.id, name: t.name, type: t.type, city: t.city, email: t.email, phone: t.phone, pan: t.pan, status: t.status, period: t.period, renewsAt: t.renewsAt, autoRenew: t.autoRenew, emailVerified: t.emailVerified, createdAt: t.createdAt,
        plan: { id: t.plan.id, name: t.plan.name, price: t.plan.price, limits: t.plan.limits },
        members: t.memberships.map((m) => ({ id: m.user.id, name: m.user.userName, email: m.user.email, role: m.role.name ?? m.role.key, status: m.status, lastActive: m.user.lastLoginAt })),
        listings: Object.fromEntries(listings.map((l) => [l.status, l._count])), leads,
        activity: activity.map((a) => ({ id: a.id, action: a.action, target: a.target, at: a.createdAt })),
        upgrades,
      },
    };
  });

  app.patch<{ Params: { id: string } }>("/admin/tenants/:id", async (request) => {
    const s = staffOf(request, "platform.business.read");
    const b = z.object({
      status: z.enum(STATUSES).optional(), planId: z.string().max(40).optional(), period: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).optional(),
      renewsAt: z.coerce.date().optional(), autoRenew: z.boolean().optional(), note: z.string().max(300).optional(),
    }).parse(request.body);
    const db = dbOf(app);
    const t = await db.tenant.findUnique({ where: { id: request.params.id } });
    if (!t) throw notFound("Business not found.");
    if (b.status && b.status !== t.status) {
      const suspending = b.status === "suspended" || b.status === "cancelled";
      if (!s.can(suspending ? "platform.business.suspend" : "platform.business.read+platform.business.create+platform.business.update")) throw forbidden("Your staff role can't change a business's status.");
    }
    if ((b.planId || b.period || b.renewsAt) && !s.can("platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete") && !s.can("platform.business.read+platform.business.create+platform.business.update")) throw forbidden("Your staff role can't change plans.");
    if (b.autoRenew !== undefined && s.role !== "super_admin") throw forbidden("Only the super admin can switch auto-renew.");
    if (b.planId) {
      const plan = await db.plan.findUnique({ where: { id: b.planId } });
      if (!plan || plan.type !== t.type) throw badRequest("Choose a plan for this business type.");
    }
    await db.tenant.update({ where: { id: t.id }, data: { status: b.status as TenantStatus | undefined, planId: b.planId, period: b.period, renewsAt: b.renewsAt, autoRenew: b.autoRenew, ...(b.planId ? { coveredById: null } : {}) } });
    await syncCovered(db, t.id);
    await audit(s, request, "admin.tenant_updated", t.name, t.id, { ...b });
    return { status: 200, message: `${t.name} updated.` };
  });

  // ───── Upgrade requests ─────
  app.get("/admin/upgrades", async (request) => {
    staffOf(request, "platform.business.read");
    const { status } = z.object({ status: z.enum(["pending", "done", "declined"]).default("pending") }).parse(request.query);
    const rows = await dbOf(app).upgradeRequest.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 200 });
    const db = dbOf(app);
    const [tenants, users, plans] = await Promise.all([
      db.tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, name: true, type: true, planId: true } }),
      db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, userName: true, email: true, phone: true } }),
      db.plan.findMany({ select: { id: true, name: true, price: true } }),
    ]);
    const byId = <T extends { id: string }>(l: T[]) => new Map(l.map((x) => [x.id, x]));
    const T = byId(tenants), U = byId(users), P = byId(plans);
    return { data: rows.map((r) => ({ ...r, tenant: T.get(r.tenantId) ?? null, user: U.get(r.userId) ?? null, plan: P.get(r.planId) ?? null })) };
  });

  app.patch<{ Params: { id: string } }>("/admin/upgrades/:id", async (request) => {
    const s = staffOf(request, "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete");
    const b = z.object({ status: z.enum(["done", "declined"]), apply: z.boolean().default(true), note: z.string().trim().max(300).optional() }).parse(request.body);
    const db = dbOf(app);
    const r = await db.upgradeRequest.findUnique({ where: { id: request.params.id } });
    if (!r || r.status !== "pending") throw notFound("Request not found or already handled.");
    await db.$transaction(async (tx) => {
      await tx.upgradeRequest.update({ where: { id: r.id }, data: { status: b.status } });
      if (b.status === "done" && b.apply) {
        // Paid and confirmed by the team: the new plan starts today for the chosen months.
        const renews = new Date(); renews.setMonth(renews.getMonth() + r.months);
        await tx.tenant.update({ where: { id: r.tenantId }, data: { planId: r.planId, period: r.months, renewsAt: renews, status: "active", coveredById: null } });
        await syncCovered(tx, r.tenantId);
      }
    });
    await audit(s, request, b.status === "done" ? "admin.upgrade_done" : "admin.upgrade_declined", r.planId, r.tenantId, b.note ? { note: b.note } : undefined);
    // Tell the business: the person who asked and the owner (once, if they are the same person).
    const plan = await db.plan.findUnique({ where: { id: r.planId }, select: { name: true } });
    const owner = await db.membership.findFirst({ where: { tenantId: r.tenantId, role: { key: "owner" }, status: "active" }, select: { userId: true } });
    const planName = plan?.name ?? r.planId;
    const applied = b.status === "done" && b.apply;
    await notify(db, [...new Set([r.userId, owner?.userId].filter((x): x is string => !!x))], {
      tenantId: r.tenantId, type: "billing", link: "/business/billing",
      title: b.status === "declined" ? `Upgrade to ${planName} not approved` : applied ? `You are now on ${planName}` : `Upgrade to ${planName} handled`,
      message: b.status === "declined" ? (b.note || "Contact Sheetal if you have questions.") : applied ? `Your ${planName} plan is active for ${r.months} ${r.months === 1 ? "month" : "months"}.` : "Sheetal has handled your request.",
    });
    return { status: 200, message: b.status === "done" ? "Plan changed." : "Request declined." };
  });

  // ───── Staff ─────
  app.get("/admin/staff", async (request) => {
    staffOf(request, "platform.staff.read");
    const rows = await dbOf(app).user.findMany({ where: { platformRole: { not: null } }, orderBy: { createdAt: "asc" }, select: { id: true, userName: true, email: true, phone: true, platformRole: true, status: true, lastLoginAt: true, passwordHash: true } });
    return { data: rows.map(({ passwordHash, ...u }) => ({ ...u, invited: !passwordHash })), roles: Object.keys(PLATFORM_ROLES) };
  });

  app.post("/admin/staff", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const s = staffOf(request, "platform.staff.read+platform.staff.create+platform.staff.update+platform.staff.remove");
    const b = z.object({ email: z.email().transform((x) => x.toLowerCase().trim()), name: z.string().trim().min(2).max(60), role: z.enum(Object.keys(PLATFORM_ROLES) as [string, ...string[]]) }).parse(request.body);
    if (b.role === "super_admin" && s.role !== "super_admin") throw forbidden("Only the super admin can add another super admin.");
    const db = dbOf(app);
    const existing = await db.user.findUnique({ where: { email: b.email } });
    if (existing?.platformRole) throw conflict(`${b.email} is already Sheetal staff.`);
    const user = existing
      ? await db.user.update({ where: { id: existing.id }, data: { platformRole: b.role } })
      : await db.user.create({ data: { email: b.email, userName: b.name, platformRole: b.role } });
    if (!user.passwordHash) {
      // New staff set their own password from a link; nobody else ever knows it.
      const token = newToken();
      await db.emailToken.create({ data: { userId: user.id, purpose: "reset_password", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 48 * 3600e3) } });
      await app.mailer.send({ to: b.email, subject: "You've been added to the Sheetal Property team", text: `${s.user.userName} added you to Sheetal Property's staff as ${b.role.replace(/_/g, " ")}.\n\nSet your password within 48 hours:\n${app.config.SITE_URL.replace(/\/$/, "")}/reset-password/${token}\n\nThen sign in at ${app.config.SITE_URL.replace(/\/$/, "")}/admin`, template: { key: "staff_added", vars: { inviter: s.user.userName, role: b.role.replace(/_/g, " "), link: `${app.config.SITE_URL.replace(/\/$/, "")}/reset-password/${token}`, site: app.config.SITE_URL.replace(/\/$/, "") } } });
    }
    await audit(s, request, "admin.staff_added", b.email, undefined, { role: b.role });
    return { status: 200, message: `${b.email} added as ${b.role.replace(/_/g, " ")}.` };
  });

  app.patch<{ Params: { id: string } }>("/admin/staff/:id", async (request) => {
    const s = staffOf(request, "platform.staff.read+platform.staff.create+platform.staff.update+platform.staff.remove");
    const b = z.object({ role: z.enum(Object.keys(PLATFORM_ROLES) as [string, ...string[]]).nullable() }).parse(request.body);
    const db = dbOf(app);
    const u = await db.user.findUnique({ where: { id: request.params.id } });
    if (!u?.platformRole) throw notFound("Staff member not found.");
    if ((u.platformRole === "super_admin" || b.role === "super_admin") && s.role !== "super_admin") throw forbidden("Only the super admin can change a super admin.");
    if (u.id === s.user.id) throw badRequest("You can't change your own staff role.");
    if (u.platformRole === "super_admin" && b.role !== "super_admin" && (await db.user.count({ where: { platformRole: "super_admin" } })) < 2) throw badRequest("There must always be a super admin.");
    await db.user.update({ where: { id: u.id }, data: { platformRole: b.role } });
    if (!b.role) await revokeAllSessions(app, u.id); // signed out everywhere at once
    await audit(s, request, b.role ? "admin.staff_role" : "admin.staff_removed", u.email, undefined, { role: b.role });
    return { status: 200, message: b.role ? "Role changed." : `${u.email} is no longer staff.` };
  });

  // ───── Audit log ─────
  // Filters: words in the action or target (q), who did it (actorId), kind (the part before the dot: billing,
  // support, tenant...), Nepal dates from/to (inclusive) and business (tenantId). GET /admin/audit.csv gives the same
  // rows as a spreadsheet (with a BOM so Excel shows Nepali names). Rules: staff with audit.view only.
  const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-10.");
  const AuditQuery = z.object({
    tenantId: z.string().max(40).optional(),
    actorId: z.string().max(40).optional(),
    kind: z.string().regex(/^[a-z_]{1,30}$/, "Pick a kind from the list.").optional(),
    q: z.string().trim().max(100).optional(),
    from: Day.optional(),
    to: Day.optional(),
    page: z.coerce.number().int().min(1).default(1),
  });
  /** Start of a Nepal day; refuses dates that don't exist (2026-02-30). */
  const nepalDayStart = (day: string) => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw badRequest(`${day} is not a real date.`);
    return new Date(`${day}T00:00:00+05:45`);
  };
  const auditWhere = (q: z.infer<typeof AuditQuery>): Prisma.AuditLogWhereInput => {
    const createdAt: { gte?: Date; lt?: Date } = {};
    if (q.from) createdAt.gte = nepalDayStart(q.from);
    if (q.to) createdAt.lt = new Date(nepalDayStart(q.to).getTime() + 864e5);
    return {
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.kind ? { action: { startsWith: `${q.kind}.` } } : {}),
      ...(q.q ? { OR: [{ action: { contains: q.q, mode: "insensitive" as const } }, { target: { contains: q.q, mode: "insensitive" as const } }] } : {}),
      ...(q.from || q.to ? { createdAt } : {}),
    };
  };
  /** Adds who did it and the business name to each row. */
  const withNames = async (rows: { actorId: string | null; tenantId: string | null }[]) => {
    const db = dbOf(app);
    const [users, tenants] = await Promise.all([
      db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } }, select: { id: true, userName: true, email: true } }),
      db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
    ]);
    return { who: new Map(users.map((u) => [u.id, u])), biz: new Map(tenants.map((t) => [t.id, t.name])) };
  };

  app.get("/admin/audit", async (request) => {
    staffOf(request, "platform.audit.read");
    const q = AuditQuery.parse(request.query);
    const where = auditWhere(q);
    const per = 100;
    const db = dbOf(app);
    const [total, rows, kindRows, staff] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * per, take: per }),
      db.$queryRaw<{ kind: string }[]>`SELECT DISTINCT split_part(action, '.', 1) AS kind FROM audit_logs ORDER BY kind`,
      db.user.findMany({ where: { platformRole: { not: null } }, select: { id: true, userName: true }, orderBy: { userName: "asc" } }),
    ]);
    const { who, biz } = await withNames(rows);
    return {
      data: rows.map((r) => ({ ...r, actor: r.actorId ? who.get(r.actorId) ?? null : null, tenant: r.tenantId ? biz.get(r.tenantId) ?? null : null })),
      meta: { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / per)), per_page: per },
      kinds: kindRows.map((k) => k.kind).filter(Boolean),
      staff,
    };
  });

  app.get("/admin/audit.csv", async (request, reply) => {
    staffOf(request, "platform.audit.read");
    const q = AuditQuery.parse(request.query);
    const rows = await dbOf(app).auditLog.findMany({ where: auditWhere(q), orderBy: { createdAt: "desc" }, take: 20000 });
    const { who, biz } = await withNames(rows);
    const cell = (v: unknown) => { const t = String(v ?? ""); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const nepal = (d: Date) => new Date(d.getTime() + 5.75 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
    const lines = [["When (Nepal)", "Who", "Email", "Action", "Target", "Business", "IP"].join(",")];
    for (const r of rows) {
      const u = r.actorId ? who.get(r.actorId) : undefined;
      lines.push([nepal(r.createdAt), u?.userName ?? "System", u?.email ?? "", r.action, r.target ?? "", r.tenantId ? biz.get(r.tenantId) ?? "" : "", r.ip ?? ""].map(cell).join(","));
    }
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="audit-log.csv"`);
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
  });
}
