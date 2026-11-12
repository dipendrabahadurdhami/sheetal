// The signed-in person's businesses, adding a business, and each business's team, roles, profile and branding.
// Where it fits: the business switcher, Team, Roles, Settings → Profile and Branding, and the invitation page.
// How it works: invitations go by email with a one-time link (7 days); people get a role and branch access; a new
// business is covered by the owner's Pro plan when they have one. Branch access is kept by branch ID (allBranches + link rows);
// since P1-BE-3 invitations and member edits write BOTH the new rows and the old branch names in one transaction (ACCESS.md 3.4),
// read the new rows, and accept `branchIds` ("all" or ids) as well as the old `scopes` (names). Answers carry both.
// P1-BE-7: the role list also carries `grants` (every role in the NEW permission names, with scopes) and the answer carries `catalog` (what the apps of this
// business offer, with each permission's scopes and the Phase 1 cap); a role being saved may hold old names, new names ("expenses.expense.read:branch"), or both.
// Rules: "team.manage" handles people, "roles.manage" roles (own roles need a plan that allows them); the owner role
// can't be edited and a business always keeps one active owner; seats count pending invitations, and making a paused
// member active again needs a free seat, like inviting.

import type { FastifyInstance } from "fastify";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { AppError, badRequest, conflict, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { newToken, sha256 } from "@sheetal/backend-core/lib/secrets";
import { requireUser } from "@sheetal/backend-core/modules/auth/sessions";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { isPro, syncCovered } from "@sheetal/backend-core/domain/billing";
import { starterPlanId } from "@sheetal/backend-core/domain/plans";
import { mediaBase, photoUrl, savePhoto } from "@sheetal/backend-core/lib/photos";
import { BUSINESS_TYPES, businessPermsFor, type BusinessType } from "@sheetal/backend-core/domain/permissions";
import { accessOfMember } from "@sheetal/platform/tenancy/context";
import { catalogForTypes, normalizeRolePerms, toGrants } from "@sheetal/platform/tenancy/catalog";
import { EVERY_BRANCH, accessColumns, accessFromNames, resolveBranchAccess, setLinks, type ResolvedAccess } from "@sheetal/platform/tenancy/branch-links";
import { branchIdsOf, branchesOf, workspaceOf, type Workspace } from "../access.js";

const INVITE_DAYS = 7;
/** Businesses one person can own (more through Sheetal support). */
const MAX_OWNED = 10;
/** The person's own business on an active Pro plan that isn't itself covered (other than `except`). */
const proOf = (user: { memberships: { tenantId: string; role: { perms: string[] }; tenant: { id: string; name: string; status: string; coveredById: string | null; plan: { price: number; features: unknown } } }[] }, except?: string) =>
  user.memberships.find((m) => m.tenantId !== except && m.role.perms.includes("*") && !m.tenant.coveredById && isPro(m.tenant.plan) && ["active", "trial", "past_due"].includes(m.tenant.status))?.tenant ?? null;
const email = z.email("Enter a valid email address.").transform((s) => s.trim().toLowerCase());
// Branch access in a body: the old way (names) or the new way (ids). Neither sent = "all" for an invitation, no change for a member.
const scopes = z.union([z.literal("all"), z.array(z.string().trim().min(1).max(60)).max(50)]);
const branchIds = z.union([z.literal("all"), z.array(z.string().trim().min(1).max(40)).max(50)]);
/** The link rows of a member or invite, in screen order, with the branch name (for the old `scopes` answer). */
const linksInclude = { select: { branchId: true, branch: { select: { name: true } } }, orderBy: [{ branch: { sort: "asc" as const } }, { branch: { createdAt: "asc" as const } }] };

const isAllAccess = (features: unknown) => !!(features as Record<string, boolean> | null)?.all_kinds;
const typesOf = (ws: Workspace): BusinessType[] => (isAllAccess(ws.member.tenant.plan.features) ? [...BUSINESS_TYPES] : [ws.member.tenant.type as BusinessType]);
// Seats on the plan plus any extra seats bought as add-ons.
const seatLimit = async (db: Parameters<typeof effectiveLimits>[0], ws: Workspace) => ((await effectiveLimits(db, ws.tenantId, ws.member.tenant.plan)).limits as Record<string, number>).seats ?? 1;

export async function teamRoutes(app: FastifyInstance) {
  /** Refuses when `adding` more people would pass the seat limit: active members plus pending, unexpired invitations (paused ones don't count). */
  const requireFreeSeat = async (ws: Workspace, adding: number) => {
    const db = dbOf(app);
    const [pending, active, limit] = await Promise.all([
      db.invite.count({ where: { tenantId: ws.tenantId, status: "pending", expiresAt: { gt: new Date() } } }),
      db.membership.count({ where: { tenantId: ws.tenantId, status: "active" } }),
      seatLimit(db, ws),
    ]);
    if (limit !== -1 && active + pending + adding > limit) {
      throw new AppError(402, "seat_limit", limit === 1 ? "The Starter plan is just you. Upgrade to add your team." : `Your plan has ${limit} seats and ${active + pending} are taken.`);
    }
  };

  const audit = (ws: Workspace, ip: string, action: string, target?: string, meta?: object) =>
    dbOf(app).auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip, meta: meta as object | undefined } });

  // ───── Me and my businesses ─────
  app.get("/workspaces", async (request) => {
    const user = requireUser(request);
    return {
      data: {
        user: { id: user.id, name: user.userName, email: user.email, phone: user.phone, emailVerified: !!user.emailVerifiedAt, platformRole: user.platformRole },
        workspaces: user.memberships.map((m) => ({
          id: m.tenant.id, name: m.tenant.name, type: m.tenant.type, city: m.tenant.city, email: m.tenant.email, phone: m.tenant.phone, logoUrl: m.tenant.logoUrl, brandColors: m.tenant.brandColors,
          pan: m.tenant.pan, address: m.tenant.address, vatRegistered: m.tenant.vatRegistered, website: m.tenant.website, coveredById: m.tenant.coveredById,
          verification: m.tenant.verification,
          status: m.tenant.status, period: m.tenant.period, renewsAt: m.tenant.renewsAt, autoRenew: m.tenant.autoRenew, createdAt: m.tenant.createdAt,
          plan: { id: m.tenant.plan.id, name: m.tenant.plan.name, price: m.tenant.plan.price, limits: m.tenant.plan.limits, features: m.tenant.plan.features },
          role: { id: m.role.id, key: m.role.key, name: m.role.name, perms: m.role.perms }, scopes: branchesOf(m), branchIds: branchIdsOf(m),
        })),
      },
    };
  });

  // ───── Add another business: the person becomes its owner; it starts on the free Starter plan of its type ─────
  app.post("/workspaces", async (request) => {
    const user = requireUser(request);
    const b = z.object({ name: z.string().trim().min(2, "Give the business a name.").max(80), type: z.enum(BUSINESS_TYPES), city: z.string().trim().max(60).optional() }).parse(request.body);
    if (!user.emailVerifiedAt) throw forbidden("Confirm your email address first.");
    const owned = user.memberships.filter((m) => m.role.perms.includes("*")).length;
    if (owned >= MAX_OWNED) throw badRequest(`You can own up to ${MAX_OWNED} businesses. Ask Sheetal support for more.`);
    if (user.memberships.some((m) => m.tenant.name.toLowerCase() === b.name.toLowerCase())) throw conflict(`You already have a business called ${b.name}.`);
    // Covered by the person's own Pro business, if they have one: Pro for its type, no bill of its own.
    const pro = proOf(user);
    const tenant = await dbOf(app).$transaction(async (tx) => {
      const t = await createWorkspace(tx, { ownerId: user.id, name: b.name, type: b.type, city: b.city, email: user.email, phone: user.phone ?? undefined, emailVerified: true, ...(pro ? { planId: `${b.type}-pro` } : {}) });
      return pro ? tx.tenant.update({ where: { id: t.id }, data: { coveredById: pro.id } }) : t;
    });
    await dbOf(app).auditLog.create({ data: { tenantId: tenant.id, actorId: user.id, action: "business.created", target: b.name, ip: request.ip, meta: pro ? { coveredBy: pro.name } : undefined } });
    return { status: 201, message: pro ? `${b.name} is ready, on Pro with ${pro.name}'s plan.` : `${b.name} is ready.`, data: { id: tenant.id } };
  });

  // ───── Cover this business with the owner's Pro plan (or stop) ─────
  app.post("/workspace/cover", async (request) => {
    const ws = workspaceOf(request);
    if (!ws.member.role.perms.includes("*")) throw forbidden("Only an owner can do this.");
    const { on } = z.object({ on: z.boolean() }).parse(request.body);
    const t = ws.member.tenant;
    if (!on) {
      if (!t.coveredById) throw badRequest("This business isn't covered by another plan.");
      await dbOf(app).tenant.update({ where: { id: t.id }, data: { coveredById: null, planId: starterPlanId(t.type as BusinessType), renewsAt: null, period: 1 } });
      return { message: `${t.name} is on its own Starter plan now.` };
    }
    const pro = proOf(ws.user, t.id);
    if (!pro) throw badRequest("You don't own a business on the Pro plan.");
    if (t.plan.price > 0 && !t.coveredById && t.renewsAt && t.renewsAt > new Date()) throw badRequest("This business has its own paid plan until it ends. Include it once that period is over.");
    if (await dbOf(app).tenant.count({ where: { coveredById: t.id } })) throw badRequest("Other businesses are covered by this one's plan.");
    await dbOf(app).$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: t.id }, data: { coveredById: pro.id } });
      await syncCovered(tx, pro.id);
      await tx.invoice.updateMany({ where: { tenantId: t.id, status: "open" }, data: { status: "void" } });
    });
    await dbOf(app).auditLog.create({ data: { tenantId: t.id, actorId: ws.user.id, action: "billing.covered", target: pro.name, ip: request.ip } });
    return { message: `${t.name} is on Pro now, with ${pro.name}'s plan.` };
  });

  // ───── Business profile: name and contact details shown on the website, bills and invoices ─────
  app.patch("/workspace/profile", async (request) => {
    const ws = workspaceOf(request);
    if (!ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete")) throw forbidden("Your role can't change the business profile.");
    const text = (max: number) => z.string().trim().max(max).transform((x) => x || null).nullish();
    const b = z.object({
      name: z.string().trim().min(2, "Enter the business name.").max(80).optional(),
      city: text(60), address: text(200), phone: text(30),
      email: z.union([z.email("Enter a valid email address.").transform((x) => x.trim().toLowerCase()), z.literal("").transform(() => null)]).nullish(),
      // Nepal PAN and VAT numbers are 9 digits.
      pan: z.union([z.string().trim().regex(/^\d{9}$/, "PAN is 9 digits."), z.literal("").transform(() => null)]).nullish(),
      vatRegistered: z.boolean().optional(),
      website: z.union([z.url("Enter the full address, starting with https://").refine((x) => /^https?:\/\//.test(x), "Enter the full address, starting with https://"), z.literal("").transform(() => null)]).nullish(),
    }).parse(request.body);
    if (b.vatRegistered && !(b.pan ?? ws.member.tenant.pan)) throw badRequest("Add the PAN/VAT number to show VAT on bills.");
    const t = await dbOf(app).tenant.update({ where: { id: ws.tenantId }, data: b });
    await audit(ws, request.ip, "business.profile_updated", t.name, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined).map(([k]) => [k, true])));
    return { message: "Business profile saved.", data: { name: t.name, city: t.city, address: t.address, phone: t.phone, email: t.email, pan: t.pan, vatRegistered: t.vatRegistered, website: t.website } };
  });

  // ───── Branding (Business and Pro): the business's logo and its colours (read from the logo, or picked) ─────
  app.put("/workspace/branding", { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
    const ws = workspaceOf(request);
    if (!ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete")) throw forbidden("Your role can't change the branding.");
    // Own logo and colours come with the Business and Pro plans; Starter keeps Sheetal's look.
    if (!ws.member.tenant.plan.price) throw new AppError(402, "plan_feature", "Your own logo and colours come with the Business and Pro plans.");
    const b = z.object({
      logo: z.string().max(3 * 1024 * 1024).nullable().optional(),
      colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use colours like #9D1D21.")).max(3, "Up to 3 colours: brand, dark and light."),
    }).parse(request.body);
    let logoUrl: string | null | undefined;
    if (b.logo === null) logoUrl = null;
    else if (b.logo) {
      const file = await savePhoto(app.config.MEDIA_DIR, Buffer.from(b.logo, "base64"), "brand");
      logoUrl = photoUrl(mediaBase(app.config), "main", file, "brand");
    }
    const colors = [...new Set(b.colors.map((c) => c.toUpperCase()))];
    await dbOf(app).tenant.update({ where: { id: ws.tenantId }, data: { brandColors: colors, ...(logoUrl !== undefined ? { logoUrl } : {}) } });
    await audit(ws, request.ip, "settings.branding", colors.join(" "));
    return { message: "Branding saved. Your workspace uses these colours now.", data: { logoUrl: logoUrl === undefined ? ws.member.tenant.logoUrl : logoUrl, brandColors: colors } };
  });

  // ───── Team ─────
  app.get("/team", async (request) => {
    const ws = workspaceOf(request);
    const db = dbOf(app);
    const [members, invites, roles, activity] = await Promise.all([
      db.membership.findMany({ where: { tenantId: ws.tenantId, status: { in: ["active", "paused"] } }, include: { user: true, branches: linksInclude }, orderBy: { createdAt: "asc" } }),
      ws.can("workspace.team.read+workspace.team.invite+workspace.team.update+workspace.team.remove") ? db.invite.findMany({ where: { tenantId: ws.tenantId, status: "pending" }, include: { branches: linksInclude }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
      db.role.findMany({ where: { tenantId: ws.tenantId }, orderBy: [{ system: "desc" }, { key: "asc" }] }),
      db.auditLog.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    const names = new Map(members.map((m) => [m.userId, m.user.userName]));
    // Branch access is read from the link rows; `scopes` (names) is computed from them for the old screens.
    const perms = new Map(roles.map((r) => [r.id, r.perms]));
    const accessOf = (x: { scopes: unknown; allBranches: boolean; branches: { branchId: string; branch: { name: string } }[]; roleId: string }) =>
      accessOfMember({ scopes: x.scopes, allBranches: x.allBranches, branches: x.branches, role: { perms: perms.get(x.roleId) ?? [] } });
    const seatsUsed = members.filter((m) => m.status === "active").length + invites.length;
    return {
      data: {
        members: members.map((m) => ({ id: m.userId, name: m.user.userName, email: m.user.email, phone: m.user.phone, roleId: m.roleId, status: m.status, scopes: accessOf(m).names, branchIds: accessOf(m).allowed, lastActive: m.user.lastLoginAt, joinedAt: m.createdAt })),
        invites: invites.map((i) => ({ id: i.id, email: i.email, roleId: i.roleId, scopes: accessOf(i).names, branchIds: accessOf(i).allowed, status: i.expiresAt < new Date() ? "expired" : i.status, sent: i.sentAt, expires: i.expiresAt, by: names.get(i.invitedBy ?? "") ?? null })),
        // `perms` is what is stored (old names, new names, or both); `grants` is the same role in NEW names with an explicit scope (P1-BE-7), whatever is stored.
        roles: roles.map((r) => ({ id: r.id, key: r.key, name: r.name, perms: r.perms, grants: toGrants(r.perms), system: r.system })),
        permissions: businessPermsFor(typesOf(ws)),
        // The new catalog (P1-BE-7): the permissions of the apps this business has, with the scopes each allows and the Phase 1 cap (no "all" for Expenses and Reviews).
        catalog: catalogForTypes(typesOf(ws)),
        seats: { used: seatsUsed, limit: await seatLimit(dbOf(app), ws) },
        activity: activity.map((a) => ({ id: a.id, who: names.get(a.actorId ?? "") ?? "Someone", what: a.action, target: a.target, at: a.createdAt })),
      },
    };
  });

  async function roleOf(ws: Workspace, roleId: string) {
    const r = await dbOf(app).role.findFirst({ where: { id: roleId, tenantId: ws.tenantId } });
    if (!r) throw badRequest("Choose a role from this business.");
    if (r.key === "owner" && ws.member.role.key !== "owner") throw forbidden("Only an owner can make someone an owner.");
    return r;
  }

  const manage = (ws: Workspace) => { if (!ws.can("workspace.team.read+workspace.team.invite+workspace.team.update+workspace.team.remove")) throw forbidden("Only people who manage the team can do this."); };

  // ───── Invitations ─────
  app.post("/team/invites", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const b = z.object({ invites: z.array(z.object({ email, roleId: z.string(), scopes: scopes.optional(), branchIds: branchIds.optional() })).min(1).max(20) }).parse(request.body);
    const db = dbOf(app);
    const access: ResolvedAccess[] = [];
    for (const inv of b.invites) access.push((await resolveBranchAccess(db, ws.tenantId, { branchIds: inv.branchIds, scopes: inv.scopes })) ?? EVERY_BRANCH);
    await requireFreeSeat(ws, b.invites.length);
    const sent: string[] = [];
    for (const [n, inv] of b.invites.entries()) {
      const role = await roleOf(ws, inv.roleId);
      if (await db.membership.findFirst({ where: { tenantId: ws.tenantId, user: { email: inv.email } } })) throw conflict(`${inv.email} is already in the team.`);
      await db.invite.updateMany({ where: { tenantId: ws.tenantId, email: inv.email, status: "pending" }, data: { status: "revoked" } });
      const token = newToken();
      const ownerRole = role.perms.includes("*");
      // The old names and the new rows are written together, so they can never disagree.
      await db.$transaction(async (tx) => {
        const row = await tx.invite.create({ data: { tenantId: ws.tenantId, email: inv.email, roleId: role.id, ...accessColumns(access[n]!, ownerRole), tokenHash: sha256(token), invitedBy: ws.user.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5) } });
        await setLinks(tx, "invite", row.id, access[n]!, ownerRole);
      });
      await sendInvite(inv.email, token, ws, role.name ?? role.key);
      await audit(ws, request.ip, "team.invited", inv.email, { role: role.key });
      sent.push(inv.email);
    }
    return { status: 200, message: sent.length === 1 ? `Invitation sent to ${sent[0]}.` : `${sent.length} invitations sent.`, data: { sent } };
  });

  async function sendInvite(to: string, token: string, ws: Workspace, roleName: string) {
    const link = `${app.config.SITE_URL.replace(/\/$/, "")}/business/accept-invite?token=${token}`;
    await app.mailer.send({
      to, subject: `${ws.user.userName} invited you to ${ws.member.tenant.name} on Sheetal Property`,
      text: `${ws.user.userName} invited you to join ${ws.member.tenant.name} as ${roleName.replace(/_/g, " ")}.\n\nAccept within ${INVITE_DAYS} days:\n${link}\n\nSign in (or create an account) with ${to} to accept. If you didn't expect this, ignore it.`,
    });
  }

  app.post<{ Params: { id: string } }>("/team/invites/:id/resend", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const inv = await dbOf(app).invite.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, status: "pending" } });
    if (!inv) throw notFound("Invitation not found.");
    const token = newToken();
    await dbOf(app).invite.update({ where: { id: inv.id }, data: { tokenHash: sha256(token), sentAt: new Date(), expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5) } });
    const role = await dbOf(app).role.findUniqueOrThrow({ where: { id: inv.roleId } });
    await sendInvite(inv.email, token, ws, role.name ?? role.key);
    return { status: 200, message: `Invitation sent again to ${inv.email}.` };
  });

  app.post<{ Params: { id: string } }>("/team/invites/:id/revoke", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const n = await dbOf(app).invite.updateMany({ where: { id: request.params.id, tenantId: ws.tenantId, status: "pending" }, data: { status: "revoked" } });
    if (!n.count) throw notFound("Invitation not found.");
    await audit(ws, request.ip, "team.invite_revoked", request.params.id);
    return { status: 200, message: "Invitation cancelled." };
  });

  // Anyone with the link can see what it is for (to show the right page), never the token itself.
  app.get("/invites/preview", async (request) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(request.query);
    const inv = await dbOf(app).invite.findUnique({ where: { tokenHash: sha256(token) }, include: { tenant: { select: { name: true, type: true } } } });
    if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) throw new AppError(410, "invite_invalid", "This invitation has expired or was already used. Ask for a new one.");
    const role = await dbOf(app).role.findUnique({ where: { id: inv.roleId }, select: { key: true, name: true } });
    return { data: { business: inv.tenant.name, type: inv.tenant.type, role: role?.name ?? role?.key, email: inv.email } };
  });

  app.post("/invites/accept", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const user = requireUser(request);
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(request.body);
    const db = dbOf(app);
    const inv = await db.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { tenant: true, branches: linksInclude } });
    if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) throw new AppError(410, "invite_invalid", "This invitation has expired or was already used. Ask for a new one.");
    if (inv.email !== user.email) throw forbidden(`This invitation is for ${inv.email}. Sign in with that email to accept it.`);
    // The membership gets the invitation's branch access: the same flag and the same branch rows, and the old names computed from them.
    // An invitation written only the old way (a list of names, flag left at "all") is read by its names, never as every branch.
    const oldWay = inv.allBranches && Array.isArray(inv.scopes);
    const links = inv.branches.map((l) => ({ id: l.branchId, name: l.branch.name }));
    const access: ResolvedAccess = oldWay
      ? accessFromNames(await db.branch.findMany({ where: { tenantId: inv.tenantId }, select: { id: true, name: true } }), inv.scopes)
      : inv.allBranches ? EVERY_BRANCH : { all: false, ids: links.map((l) => l.id), names: links.map((l) => l.name) };
    await db.$transaction(async (tx) => {
      const cols = { scopes: access.all ? (inv.scopes as object) : access.names, allBranches: access.all };
      const m = await tx.membership.upsert({ where: { userId_tenantId: { userId: user.id, tenantId: inv.tenantId } }, create: { userId: user.id, tenantId: inv.tenantId, roleId: inv.roleId, ...cols }, update: { roleId: inv.roleId, ...cols, status: "active" } });
      await setLinks(tx, "membership", m.id, access, false);
      await tx.invite.update({ where: { id: inv.id }, data: { status: "accepted" } });
      await tx.auditLog.create({ data: { tenantId: inv.tenantId, actorId: user.id, action: "team.joined", target: user.email, ip: request.ip } });
    });
    return { status: 200, message: `Welcome to ${inv.tenant.name}.`, data: { tenantId: inv.tenantId } };
  });

  // ───── Members ─────
  async function memberFor(ws: Workspace, userId: string) {
    const m = await dbOf(app).membership.findFirst({ where: { tenantId: ws.tenantId, userId }, include: { role: true, branches: linksInclude, user: { select: { userName: true, email: true } } } });
    if (!m) throw notFound("Team member not found.");
    return m;
  }
  const otherOwners = (ws: Workspace, userId: string) =>
    dbOf(app).membership.count({ where: { tenantId: ws.tenantId, status: "active", role: { key: "owner" }, userId: { not: userId } } });

  app.patch<{ Params: { userId: string } }>("/team/members/:userId", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const b = z.object({ roleId: z.string().optional(), status: z.enum(["active", "paused"]).optional(), scopes: scopes.optional(), branchIds: branchIds.optional() }).parse(request.body);
    const asked = await resolveBranchAccess(dbOf(app), ws.tenantId, { branchIds: b.branchIds, scopes: b.scopes });
    const m = await memberFor(ws, request.params.userId);
    if (m.role.key === "owner" && ws.member.role.key !== "owner") throw forbidden("Only an owner can change an owner.");
    const role = b.roleId ? await roleOf(ws, b.roleId) : null;
    const losingOwner = m.role.key === "owner" && ((role && role.key !== "owner") || b.status === "paused");
    if (losingOwner && !(await otherOwners(ws, m.userId))) throw badRequest("A business needs at least one active owner. Make someone else an owner first.");
    // A paused member comes back only if there is a seat for them (the same refusal as inviting).
    if (b.status === "active" && m.status !== "active") await requireFreeSeat(ws, 1);
    // Becoming an owner, or stopping being one, changes how the stored access is read: keep what the person has, only re-flag it.
    const ownerNow = (role ?? m.role).perms.includes("*");
    let access: ResolvedAccess | undefined = asked;
    if (!access && role && ownerNow !== m.role.perms.includes("*")) {
      const links = m.branches.map((l) => ({ id: l.branchId, name: l.branch.name }));
      access = !m.allBranches ? { all: false, ids: links.map((l) => l.id), names: links.map((l) => l.name) }
        : Array.isArray(m.scopes) ? accessFromNames(await dbOf(app).branch.findMany({ where: { tenantId: ws.tenantId }, select: { id: true, name: true } }), m.scopes)
        : EVERY_BRANCH;
    }
    await dbOf(app).$transaction(async (tx) => {
      await tx.membership.update({ where: { id: m.id }, data: { roleId: role?.id, status: b.status, ...(access ? accessColumns(access, ownerNow) : {}) } });
      if (access) await setLinks(tx, "membership", m.id, access, ownerNow);
    });
    await audit(ws, request.ip, "team.updated", m.user.email, { role: role?.key, status: b.status });
    return { status: 200, message: `${m.user.userName} updated.` };
  });

  app.delete<{ Params: { userId: string } }>("/team/members/:userId", async (request) => {
    const ws = workspaceOf(request);
    const leaving = request.params.userId === ws.user.id;
    if (!leaving) manage(ws);
    const m = await memberFor(ws, request.params.userId);
    if (m.role.key === "owner" && !leaving && ws.member.role.key !== "owner") throw forbidden("Only an owner can remove an owner.");
    if (m.role.key === "owner" && !(await otherOwners(ws, m.userId))) throw badRequest("A business needs at least one active owner.");
    await dbOf(app).membership.delete({ where: { id: m.id } });
    // Their mailboxes stay with the business; they just can't open them any more.
    await audit(ws, request.ip, leaving ? "team.left" : "team.removed", m.user.email);
    return { status: 200, message: leaving ? "You left the business." : `${m.user.userName} was removed.` };
  });

  // ───── Roles ─────
  const roleBody = z.object({ name: z.string().trim().min(2).max(60), perms: z.array(z.string()).max(200) });
  // Accepts the OLD names (kept as sent, until the rewrite) and the NEW names with a scope (stored with the scope written out). ACCESS.md 5.2 and 8.
  const checkPerms = (ws: Workspace, perms: string[]) => {
    const r = normalizeRolePerms(perms, { catalog: catalogForTypes(typesOf(ws)), oldAllowed: new Set(businessPermsFor(typesOf(ws))) });
    if (r.unknown.length) throw badRequest(`Unknown permissions: ${r.unknown.join(", ")}`);
    if (r.refused.length) throw badRequest(r.refused.join(" "));
    return r.perms;
  };
  const rolesAdmin = (ws: Workspace) => { if (!ws.can("workspace.role.read+workspace.role.create+workspace.role.update+workspace.role.delete")) throw forbidden("Only people who manage roles can do this."); };

  app.post("/team/roles", async (request) => {
    const ws = workspaceOf(request); rolesAdmin(ws);
    if (!(ws.member.tenant.plan.features as Record<string, boolean>).custom_roles) throw new AppError(402, "upgrade_needed", "Your own roles are part of the Business and Pro plans.");
    const b = roleBody.parse(request.body);
    const key = `custom_${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)}_${Math.random().toString(36).slice(2, 6)}`;
    const r = await dbOf(app).role.create({ data: { tenantId: ws.tenantId, key, name: b.name, perms: checkPerms(ws, b.perms), system: false } });
    await audit(ws, request.ip, "role.created", b.name);
    return { status: 200, message: `Role "${b.name}" created.`, data: { id: r.id } };
  });

  app.patch<{ Params: { id: string } }>("/team/roles/:id", async (request) => {
    const ws = workspaceOf(request); rolesAdmin(ws);
    const b = roleBody.partial().parse(request.body);
    const r = await dbOf(app).role.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId } });
    if (!r) throw notFound("Role not found.");
    if (r.key === "owner") throw badRequest("The owner role always has every permission.");
    await dbOf(app).role.update({ where: { id: r.id }, data: { name: b.name, perms: b.perms ? checkPerms(ws, b.perms) : undefined } });
    await audit(ws, request.ip, "role.updated", b.name ?? r.name ?? r.key);
    return { status: 200, message: "Role saved." };
  });

  app.delete<{ Params: { id: string } }>("/team/roles/:id", async (request) => {
    const ws = workspaceOf(request); rolesAdmin(ws);
    const r = await dbOf(app).role.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId }, include: { _count: { select: { memberships: true } } } });
    if (!r) throw notFound("Role not found.");
    if (r.system) throw badRequest("Built-in roles can't be deleted.");
    if (r._count.memberships) throw badRequest("Move the people in this role to another role first.");
    await dbOf(app).role.delete({ where: { id: r.id } });
    await audit(ws, request.ip, "role.deleted", r.name ?? r.key);
    return { status: 200, message: "Role deleted." };
  });
}
