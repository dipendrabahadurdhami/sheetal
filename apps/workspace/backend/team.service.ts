// The rules of a business's team on the kernel: the person's businesses, adding a business, Pro cover, the business profile and branding, members,
// invitations and roles. Moved from business/backend/src/modules/team/routes.ts in P2-W6 (Workspace part 2); every rule, message, status code and audit
// string unchanged.
// Where it fits: TeamController calls one method per route. Most routes run with the business context (who, which business, which permissions); four
// run before there is one: the person's own list of businesses, adding a business, and the invitation preview and accept pages.
// How it works: invitations go by email with a one-time link (7 days; only its hash is stored); people get a role and branch access (kept by branch ID:
// allBranches + link rows, with the old names written in the same transaction, ACCESS.md 3.4); a new business is covered by the owner's Pro plan when they
// have one. Each change runs in ONE transaction with its audit line and its event; an invitation email is sent only after its row is saved.
// Rules: people who manage the team handle people, people who manage roles handle roles (own roles need a plan that allows them); the owner role can't be
// edited and a business always keeps one active owner; only an owner makes or changes an owner; seats count pending invitations, and making a paused
// member active again needs a free seat, like inviting. A read-only support session changes nothing, and a support session never invites, changes or
// removes people or roles (ACCESS.md 12).

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { AppError, badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BusinessEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import { newToken, sha256 } from "@sheetal/platform/auth/secrets";
import { accessOfMember } from "@sheetal/platform/tenancy/context";
import { catalogForTypes, normalizeRolePerms, toGrants } from "@sheetal/platform/tenancy/catalog";
import { EVERY_BRANCH, accessColumns, accessFromNames, resolveBranchAccess, setLinks, type ResolvedAccess } from "@sheetal/platform/tenancy/branch-links";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { isPro, syncCovered } from "@sheetal/backend-core/domain/billing";
import { starterPlanId } from "@sheetal/backend-core/domain/plans";
import { photoUrl, savePhoto } from "@sheetal/backend-core/lib/photos";
import { BUSINESS_TYPES, businessPermsFor, type BusinessType } from "@sheetal/backend-core/domain/permissions";
import { InviteTokenRepository, TeamRepository } from "./team.repository.js";
import { SETTINGS_PERM } from "./workspace.service.js";

type Tx = Prisma.TransactionClient;
const INVITE_DAYS = 7;
/** Businesses one person can own (more through Sheetal support). */
const MAX_OWNED = 10;
export const TEAM_PERM = "workspace.team.read+workspace.team.invite+workspace.team.update+workspace.team.remove";
export const ROLES_PERM = "workspace.role.read+workspace.role.create+workspace.role.update+workspace.role.delete";
/** Since stage 1.5 a role is saved in the manifests' names only: a name from before is answered as an unknown permission. */
const NO_OLD_NAMES: ReadonlySet<string> = new Set();

/** The signed-in person, as the session gives them (business/backend's requireUser). Only what these rules read. */
export interface TeamUser {
  id: string; userName: string; email: string; phone: string | null; emailVerifiedAt: Date | null; platformRole?: string | null;
  memberships: {
    tenantId: string; scopes: unknown; allBranches: boolean; branches: { branchId: string; branch?: { name: string } }[];
    role: { id: string; key: string; name: string | null; perms: string[] };
    tenant: {
      id: string; name: string; type: string; city: string | null; email: string | null; phone: string | null; logoUrl: string | null; brandColors: unknown; pan: string | null;
      address: string | null; vatRegistered: boolean; website: string | null; coveredById: string | null; verification: unknown; status: string; period: number;
      renewsAt: Date | null; autoRenew: boolean; createdAt: Date; plan: { id: string; name: string; price: number; limits: unknown; features: unknown };
    };
  }[];
}
/** The request, for the four routes that run before there is a business context. */
export interface RequestInfo { ip: string; requestId: string; log: FastifyBaseLogger }
export interface TeamDeps {
  bus: EventBus; db: unknown; siteUrl: string; mediaDir: string; mediaBase: string;
  mail: (m: { to: string; subject: string; text: string }) => Promise<unknown>;
}

/** The person's own business on an active Pro plan that isn't itself covered (other than `except`). */
const proOf = (user: TeamUser, except?: string) =>
  user.memberships.find((m) => m.tenantId !== except && m.role.perms.includes("*") && !m.tenant.coveredById && isPro(m.tenant.plan) && ["active", "trial", "past_due"].includes(m.tenant.status))?.tenant ?? null;
const email = z.email("Enter a valid email address.").transform((s) => s.trim().toLowerCase());
// Branch access in a body: the old way (names) or the new way (ids). Neither sent = "all" for an invitation, no change for a member.
const scopes = z.union([z.literal("all"), z.array(z.string().trim().min(1).max(60)).max(50)]);
const branchIds = z.union([z.literal("all"), z.array(z.string().trim().min(1).max(40)).max(50)]);
const roleBody = z.object({ name: z.string().trim().min(2).max(60), perms: z.array(z.string()).max(200) });
const token = z.string().min(20).max(100);
const invalidInvite = () => new AppError(410, "invite_invalid", "This invitation has expired or was already used. Ask for a new one.");
type Line = { audit: { action: string; target?: string; meta?: object }; event: { name: string; payload: object } };

class TenantBase extends BaseRepository<BusinessEntity, never, never> {
  constructor() { super({ model: "membership", branchField: null, ownerField: null, label: "This team member", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "asc" }] }); }
}

export class TeamService extends BaseService<BusinessEntity, never, never> {
  readonly team = new TeamRepository();
  readonly tokens = new InviteTokenRepository();
  constructor(private readonly x: TeamDeps) {
    super({ app: "workspace", resource: "team", repo: new TenantBase(), permissions: { read: TEAM_PERM, create: TEAM_PERM, update: TEAM_PERM, delete: TEAM_PERM },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "team", label: (m) => m.id }, bus: x.bus, requireVersion: false });
  }

  /** One change: its rows, its audit line and its event in ONE transaction. A read-only support session is refused first. */
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => Line): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      await this.writeAudit(tx, a.audit.action, a.audit.target as string, a.audit.meta);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1);
      return r;
    });
  }
  /** The same for the routes with no business context yet (adding a business, accepting an invitation): the event carries the business it is about. */
  private async userWrite<R>(info: RequestInfo, user: { id: string; userName: string }, run: (tx: Tx) => Promise<{ r: R; tenantId: string; line: Line }>): Promise<R> {
    const client = this.x.db as { $transaction<X>(fn: (tx: Tx) => Promise<X>): Promise<X> };
    return client.$transaction(async (tx) => {
      const { r, tenantId, line } = await run(tx);
      await this.tokens.audit(tx, { tenantId, actorId: user.id, action: line.audit.action, target: line.audit.target, ip: info.ip, meta: line.audit.meta as Prisma.InputJsonValue | undefined });
      const ctx = { requestId: info.requestId, ip: info.ip, now: new Date(), log: info.log, db: this.x.db, tx, actor: { kind: "user", userId: user.id, name: user.userName }, business: { id: tenantId } };
      await this.deps.bus.publish(ctx as never, line.event.name, line.event.payload, 1);
      return r;
    });
  }

  private typesOf(ctx: BusinessContext): BusinessType[] { return ctx.entitlements.feature("all_kinds") ? [...BUSINESS_TYPES] : [ctx.business.type as BusinessType]; }
  /** Seats on the plan plus any extra seats bought as add-ons; -1 = no limit (as the old answer said it). */
  private seatLimit(ctx: BusinessContext) { return ctx.entitlements.seats().limit ?? -1; }
  /** Refuses when `adding` more people would pass the seat limit: active members plus pending, unexpired invitations (paused ones don't count). */
  private async requireFreeSeat(ctx: BusinessContext, adding: number) {
    const taken = await this.team.seatsTaken(ctx), limit = this.seatLimit(ctx);
    if (limit !== -1 && taken + adding > limit) {
      throw new AppError(402, "seat_limit", limit === 1 ? "The Starter plan is just you. Upgrade to add your team." : `Your plan has ${limit} seats and ${taken} are taken.`);
    }
  }
  private manage(ctx: BusinessContext) { if (!ctx.permissions.can(TEAM_PERM)) throw forbidden("Only people who manage the team can do this."); }
  private rolesAdmin(ctx: BusinessContext) { if (!ctx.permissions.can(ROLES_PERM)) throw forbidden("Only people who manage roles can do this."); }
  private async roleFor(ctx: BusinessContext, roleId: string) {
    const r = await this.team.role(ctx, roleId);
    if (!r) throw badRequest("Choose a role from this business.");
    if (r.key === "owner" && ctx.member.roleKey !== "owner") throw forbidden("Only an owner can make someone an owner.");
    return r;
  }
  private async memberOf(ctx: BusinessContext, userId: string) {
    const m = await this.team.member(ctx, userId);
    if (!m) throw notFound("Team member not found.");
    return m;
  }
  // Accepts the NEW names with a scope (stored with the scope written out). ACCESS.md 5.2 and 8.
  private checkPerms(ctx: BusinessContext, perms: string[]) {
    const r = normalizeRolePerms(perms, { catalog: catalogForTypes(this.typesOf(ctx)), oldAllowed: NO_OLD_NAMES });
    if (r.unknown.length) throw badRequest(`Unknown permissions: ${r.unknown.join(", ")}`);
    if (r.refused.length) throw badRequest(r.refused.join(" "));
    return r.perms;
  }

  // ───── Me and my businesses ─────
  myBusinesses(user: TeamUser) {
    return {
      user: { id: user.id, name: user.userName, email: user.email, phone: user.phone, emailVerified: !!user.emailVerifiedAt, platformRole: user.platformRole },
      workspaces: user.memberships.map((m) => {
        const a = accessOfMember(m as never);
        return {
          id: m.tenant.id, name: m.tenant.name, type: m.tenant.type, city: m.tenant.city, email: m.tenant.email, phone: m.tenant.phone, logoUrl: m.tenant.logoUrl, brandColors: m.tenant.brandColors,
          pan: m.tenant.pan, address: m.tenant.address, vatRegistered: m.tenant.vatRegistered, website: m.tenant.website, coveredById: m.tenant.coveredById,
          verification: m.tenant.verification,
          status: m.tenant.status, period: m.tenant.period, renewsAt: m.tenant.renewsAt, autoRenew: m.tenant.autoRenew, createdAt: m.tenant.createdAt,
          plan: { id: m.tenant.plan.id, name: m.tenant.plan.name, price: m.tenant.plan.price, limits: m.tenant.plan.limits, features: m.tenant.plan.features },
          role: { id: m.role.id, key: m.role.key, name: m.role.name, perms: m.role.perms }, scopes: a.names, branchIds: a.allowed,
        };
      }),
    };
  }

  // ───── Add another business: the person becomes its owner; it starts on the free Starter plan of its type ─────
  async addBusiness(info: RequestInfo, user: TeamUser, raw: unknown) {
    const b = z.object({ name: z.string().trim().min(2, "Give the business a name.").max(80), type: z.enum(BUSINESS_TYPES), city: z.string().trim().max(60).optional() }).parse(raw);
    if (!user.emailVerifiedAt) throw forbidden("Confirm your email address first.");
    const owned = user.memberships.filter((m) => m.role.perms.includes("*")).length;
    if (owned >= MAX_OWNED) throw badRequest(`You can own up to ${MAX_OWNED} businesses. Ask Sheetal support for more.`);
    if (user.memberships.some((m) => m.tenant.name.toLowerCase() === b.name.toLowerCase())) throw conflict(`You already have a business called ${b.name}.`);
    // Covered by the person's own Pro business, if they have one: Pro for its type, no bill of its own.
    const pro = proOf(user);
    const tenant = await this.userWrite(info, user, async (tx) => {
      const t = await createWorkspace(tx, { ownerId: user.id, name: b.name, type: b.type, city: b.city, email: user.email, phone: user.phone ?? undefined, emailVerified: true, ...(pro ? { planId: `${b.type}-pro` } : {}) });
      const r = pro ? await this.tokens.coverNew(tx, t.id, pro.id) : t;
      return { r, tenantId: r.id, line: { audit: { action: "business.created", target: b.name, meta: pro ? { coveredBy: pro.name } : undefined }, event: { name: "workspace.business.created", payload: { id: r.id } } } };
    });
    return { status: 201, message: pro ? `${b.name} is ready, on Pro with ${pro.name}'s plan.` : `${b.name} is ready.`, data: { id: tenant.id } };
  }

  // ───── Cover this business with the owner's Pro plan (or stop) ─────
  async cover(ctx: BusinessContext, user: TeamUser | null, raw: unknown) {
    this.refuseReadOnly(ctx);
    if (!ctx.member.isOwner || !user) throw forbidden("Only an owner can do this.");
    const { on } = z.object({ on: z.boolean() }).parse(raw);
    const t = await this.team.tenant(ctx);
    if (!on) {
      if (!t.coveredById) throw badRequest("This business isn't covered by another plan.");
      await this.write(ctx, (tx) => this.team.saveTenant(tx, { coveredById: null, planId: starterPlanId(t.type as BusinessType), renewsAt: null, period: 1 }),
        () => ({ audit: { action: "billing.uncovered", target: t.name }, event: { name: "workspace.business.covered", payload: { on: false } } }));
      return { message: `${t.name} is on its own Starter plan now.` };
    }
    const pro = proOf(user, t.id);
    if (!pro) throw badRequest("You don't own a business on the Pro plan.");
    if (t.plan.price > 0 && !t.coveredById && t.renewsAt && t.renewsAt > new Date()) throw badRequest("This business has its own paid plan until it ends. Include it once that period is over.");
    if (await this.team.coveredByThis(ctx)) throw badRequest("Other businesses are covered by this one's plan.");
    await this.write(ctx, async (tx) => {
      await this.team.saveTenant(tx, { coveredById: pro.id });
      await syncCovered(tx.tx as never, pro.id);
      await this.team.voidOpenInvoices(tx);
    }, () => ({ audit: { action: "billing.covered", target: pro.name }, event: { name: "workspace.business.covered", payload: { on: true } } }));
    return { message: `${t.name} is on Pro now, with ${pro.name}'s plan.` };
  }

  // ───── Business profile: name and contact details shown on the website, bills and invoices ─────
  async saveProfile(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    if (!ctx.permissions.can(SETTINGS_PERM)) throw forbidden("Your role can't change the business profile.");
    const text = (max: number) => z.string().trim().max(max).transform((x) => x || null).nullish();
    const b = z.object({
      name: z.string().trim().min(2, "Enter the business name.").max(80).optional(),
      city: text(60), address: text(200), phone: text(30),
      email: z.union([z.email("Enter a valid email address.").transform((x) => x.trim().toLowerCase()), z.literal("").transform(() => null)]).nullish(),
      // Nepal PAN and VAT numbers are 9 digits.
      pan: z.union([z.string().trim().regex(/^\d{9}$/, "PAN is 9 digits."), z.literal("").transform(() => null)]).nullish(),
      vatRegistered: z.boolean().optional(),
      website: z.union([z.url("Enter the full address, starting with https://").refine((x) => /^https?:\/\//.test(x), "Enter the full address, starting with https://"), z.literal("").transform(() => null)]).nullish(),
    }).parse(raw);
    if (b.vatRegistered && !(b.pan ?? (await this.team.tenant(ctx)).pan)) throw badRequest("Add the PAN/VAT number to show VAT on bills.");
    const t = await this.write(ctx, (tx) => this.team.saveTenant(tx, b),
      (t) => ({ audit: { action: "business.profile_updated", target: t.name, meta: Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined).map(([k]) => [k, true])) }, event: { name: "workspace.profile.saved", payload: { id: t.id } } }));
    return { message: "Business profile saved.", data: { name: t.name, city: t.city, address: t.address, phone: t.phone, email: t.email, pan: t.pan, vatRegistered: t.vatRegistered, website: t.website } };
  }

  // ───── Branding (Business and Pro): the business's logo and its colours (read from the logo, or picked) ─────
  async saveBranding(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    if (!ctx.permissions.can(SETTINGS_PERM)) throw forbidden("Your role can't change the branding.");
    // Own logo and colours come with the Business and Pro plans; Starter keeps Sheetal's look.
    const t = await this.team.tenant(ctx);
    if (!t.plan.price) throw new AppError(402, "plan_feature", "Your own logo and colours come with the Business and Pro plans.");
    const b = z.object({
      logo: z.string().max(3 * 1024 * 1024).nullable().optional(),
      colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use colours like #9D1D21.")).max(3, "Up to 3 colours: brand, dark and light."),
    }).parse(raw);
    let logoUrl: string | null | undefined;
    if (b.logo === null) logoUrl = null;
    else if (b.logo) {
      const file = await savePhoto(this.x.mediaDir, Buffer.from(b.logo, "base64"), "brand");
      logoUrl = photoUrl(this.x.mediaBase, "main", file, "brand");
    }
    const colors = [...new Set(b.colors.map((c) => c.toUpperCase()))];
    await this.write(ctx, (tx) => this.team.saveTenant(tx, { brandColors: colors, ...(logoUrl !== undefined ? { logoUrl } : {}) }),
      () => ({ audit: { action: "settings.branding", target: colors.join(" ") }, event: { name: "workspace.branding.saved", payload: { id: t.id } } }));
    return { message: "Branding saved. Your workspace uses these colours now.", data: { logoUrl: logoUrl === undefined ? t.logoUrl : logoUrl, brandColors: colors } };
  }

  // ───── Team ─────
  async teamPage(ctx: BusinessContext) {
    const [members, invites, roles, activity] = await Promise.all([
      this.team.members(ctx), ctx.permissions.can(TEAM_PERM) ? this.team.pendingInvites(ctx) : Promise.resolve([]), this.team.roles(ctx), this.team.activity(ctx),
    ]);
    const names = new Map(members.map((m) => [m.userId, m.user.userName]));
    // Branch access is read from the link rows; `scopes` (names) is computed from them for the old screens.
    const perms = new Map(roles.map((r) => [r.id, r.perms]));
    const accessOf = (x: { scopes: unknown; allBranches: boolean; branches: { branchId: string; branch: { name: string } }[]; roleId: string }) =>
      accessOfMember({ scopes: x.scopes, allBranches: x.allBranches, branches: x.branches, role: { perms: perms.get(x.roleId) ?? [] } });
    const seatsUsed = members.filter((m) => m.status === "active").length + invites.length;
    return {
      members: members.map((m) => ({ id: m.userId, name: m.user.userName, email: m.user.email, phone: m.user.phone, roleId: m.roleId, status: m.status, scopes: accessOf(m).names, branchIds: accessOf(m).allowed, lastActive: m.user.lastLoginAt, joinedAt: m.createdAt })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, roleId: i.roleId, scopes: accessOf(i).names, branchIds: accessOf(i).allowed, status: i.expiresAt < new Date() ? "expired" : i.status, sent: i.sentAt, expires: i.expiresAt, by: names.get(i.invitedBy ?? "") ?? null })),
      // `perms` is what is stored; `grants` is the same role with an explicit scope (P1-BE-7), whatever is stored.
      roles: roles.map((r) => ({ id: r.id, key: r.key, name: r.name, perms: r.perms, grants: toGrants(r.perms), system: r.system })),
      permissions: businessPermsFor(this.typesOf(ctx)),
      // The catalog (P1-BE-7): the permissions of the apps this business has, with the scopes each allows and the Phase 1 cap.
      catalog: catalogForTypes(this.typesOf(ctx)),
      seats: { used: seatsUsed, limit: this.seatLimit(ctx) },
      activity: activity.map((a) => ({ id: a.id, who: names.get(a.actorId ?? "") ?? "Someone", what: a.action, target: a.target, at: a.createdAt })),
    };
  }

  // ───── Invitations ─────
  private async sendInvite(ctx: BusinessContext, to: string, tok: string, roleName: string) {
    const link = `${this.x.siteUrl.replace(/\/$/, "")}/business/accept-invite?token=${tok}`;
    await this.x.mail({
      to, subject: `${ctx.actor.kind === "user" ? ctx.actor.name : "Sheetal Property"} invited you to ${ctx.business.name} on Sheetal Property`,
      text: `${ctx.actor.kind === "user" ? ctx.actor.name : "Sheetal Property"} invited you to join ${ctx.business.name} as ${roleName.replace(/_/g, " ")}.\n\nAccept within ${INVITE_DAYS} days:\n${link}\n\nSign in (or create an account) with ${to} to accept. If you didn't expect this, ignore it.`,
    });
  }
  async invite(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.manage(ctx);
    const b = z.object({ invites: z.array(z.object({ email, roleId: z.string(), scopes: scopes.optional(), branchIds: branchIds.optional() })).min(1).max(20) }).parse(raw);
    const access: ResolvedAccess[] = [];
    for (const inv of b.invites) access.push((await resolveBranchAccess(ctx.db as never, ctx.business.id, { branchIds: inv.branchIds, scopes: inv.scopes })) ?? EVERY_BRANCH);
    await this.requireFreeSeat(ctx, b.invites.length);
    const sent: string[] = [];
    for (const [n, inv] of b.invites.entries()) {
      const role = await this.roleFor(ctx, inv.roleId);
      if (await this.team.memberByEmail(ctx, inv.email)) throw conflict(`${inv.email} is already in the team.`);
      const tok = newToken();
      const ownerRole = role.perms.includes("*");
      // The earlier pending invitation, the new row, the old names and the new link rows, the audit line and the event: one transaction.
      await this.write(ctx, async (tx) => {
        await this.team.revokePendingFor(tx, inv.email);
        const row = await this.team.createInvite(tx, { email: inv.email, roleId: role.id, ...accessColumns(access[n]!, ownerRole), tokenHash: sha256(tok), invitedBy: ctx.member.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5) });
        await setLinks(tx.tx as never, "invite", row.id, access[n]!, ownerRole);
        return row;
      }, (row) => ({ audit: { action: "team.invited", target: inv.email, meta: { role: role.key } }, event: { name: "workspace.invite.sent", payload: { id: row.id } } }));
      await this.sendInvite(ctx, inv.email, tok, role.name ?? role.key);
      sent.push(inv.email);
    }
    return { status: 200, message: sent.length === 1 ? `Invitation sent to ${sent[0]}.` : `${sent.length} invitations sent.`, data: { sent } };
  }
  async resendInvite(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    this.manage(ctx);
    const inv = await this.team.pendingInvite(ctx, id);
    if (!inv) throw notFound("Invitation not found.");
    const tok = newToken();
    await this.write(ctx, (tx) => this.team.renewInvite(tx, inv.id, sha256(tok), new Date(Date.now() + INVITE_DAYS * 864e5)),
      () => ({ audit: { action: "team.invite_resent", target: inv.email }, event: { name: "workspace.invite.sent", payload: { id: inv.id } } }));
    const role = await this.team.roleById(ctx, inv.roleId);
    await this.sendInvite(ctx, inv.email, tok, role.name ?? role.key);
    return { status: 200, message: `Invitation sent again to ${inv.email}.` };
  }
  async revokeInvite(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    this.manage(ctx);
    await this.write(ctx, async (tx) => { if (!(await this.team.revokeInvite(tx, id))) throw notFound("Invitation not found."); },
      () => ({ audit: { action: "team.invite_revoked", target: id }, event: { name: "workspace.invite.revoked", payload: { id } } }));
    return { status: 200, message: "Invitation cancelled." };
  }

  // Anyone with the link can see what it is for (to show the right page), never the token itself.
  async previewInvite(rawQuery: unknown) {
    const q = z.object({ token }).parse(rawQuery);
    const d = this.x.db as Tx;
    const inv = await this.tokens.byToken(d, sha256(q.token));
    if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) throw invalidInvite();
    const role = await this.tokens.roleName(d, inv.roleId);
    return { business: inv.tenant.name, type: inv.tenant.type, role: role?.name ?? role?.key, email: inv.email };
  }
  async acceptInvite(info: RequestInfo, user: { id: string; userName: string; email: string }, raw: unknown) {
    const b = z.object({ token }).parse(raw);
    const d = this.x.db as Tx;
    const inv = await this.tokens.forAccept(d, sha256(b.token));
    if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) throw invalidInvite();
    if (inv.email !== user.email) throw forbidden(`This invitation is for ${inv.email}. Sign in with that email to accept it.`);
    // The membership gets the invitation's branch access: the same flag and the same branch rows, and the old names computed from them.
    // An invitation written only the old way (a list of names, flag left at "all") is read by its names, never as every branch.
    const oldWay = inv.allBranches && Array.isArray(inv.scopes);
    const links = inv.branches.map((l) => ({ id: l.branchId, name: l.branch.name }));
    const access: ResolvedAccess = oldWay
      ? accessFromNames(await this.tokens.branchNames(d, inv.tenantId), inv.scopes)
      : inv.allBranches ? EVERY_BRANCH : { all: false, ids: links.map((l) => l.id), names: links.map((l) => l.name) };
    await this.userWrite(info, user, async (tx) => {
      const m = await this.tokens.join(tx, { userId: user.id, tenantId: inv.tenantId, roleId: inv.roleId, scopes: (access.all ? inv.scopes : access.names) as Prisma.InputJsonValue, allBranches: access.all });
      await setLinks(tx, "membership", m.id, access, false);
      await this.tokens.accepted(tx, inv.id);
      return { r: m, tenantId: inv.tenantId, line: { audit: { action: "team.joined", target: user.email }, event: { name: "workspace.member.joined", payload: { userId: user.id } } } };
    });
    return { status: 200, message: `Welcome to ${inv.tenant.name}.`, data: { tenantId: inv.tenantId } };
  }

  // ───── Members ─────
  async editMember(ctx: BusinessContext, userId: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.manage(ctx);
    const b = z.object({ roleId: z.string().optional(), status: z.enum(["active", "paused"]).optional(), scopes: scopes.optional(), branchIds: branchIds.optional() }).parse(raw);
    const asked = await resolveBranchAccess(ctx.db as never, ctx.business.id, { branchIds: b.branchIds, scopes: b.scopes });
    const m = await this.memberOf(ctx, userId);
    if (m.role.key === "owner" && ctx.member.roleKey !== "owner") throw forbidden("Only an owner can change an owner.");
    const role = b.roleId ? await this.roleFor(ctx, b.roleId) : null;
    const losingOwner = m.role.key === "owner" && ((role && role.key !== "owner") || b.status === "paused");
    if (losingOwner && !(await this.team.otherOwners(ctx, m.userId))) throw badRequest("A business needs at least one active owner. Make someone else an owner first.");
    // A paused member comes back only if there is a seat for them (the same refusal as inviting).
    if (b.status === "active" && m.status !== "active") await this.requireFreeSeat(ctx, 1);
    // Becoming an owner, or stopping being one, changes how the stored access is read: keep what the person has, only re-flag it.
    const ownerNow = (role ?? m.role).perms.includes("*");
    let access: ResolvedAccess | undefined = asked;
    if (!access && role && ownerNow !== m.role.perms.includes("*")) {
      const links = m.branches.map((l) => ({ id: l.branchId, name: l.branch.name }));
      access = !m.allBranches ? { all: false, ids: links.map((l) => l.id), names: links.map((l) => l.name) }
        : Array.isArray(m.scopes) ? accessFromNames(await this.team.branchNames(ctx), m.scopes)
        : EVERY_BRANCH;
    }
    await this.write(ctx, async (tx) => {
      await this.team.updateMember(tx, m.id, { roleId: role?.id, status: b.status, ...(access ? accessColumns(access, ownerNow) : {}) });
      if (access) await setLinks(tx.tx as never, "membership", m.id, access, ownerNow);
    }, () => ({ audit: { action: "team.updated", target: m.user.email, meta: { role: role?.key, status: b.status } }, event: { name: "workspace.member.updated", payload: { userId: m.userId, status: b.status ?? m.status } } }));
    return { status: 200, message: `${m.user.userName} updated.` };
  }
  async removeMember(ctx: BusinessContext, userId: string) {
    this.refuseReadOnly(ctx);
    const leaving = userId === ctx.member.userId && ctx.actor.kind === "user";
    if (!leaving) this.manage(ctx);
    const m = await this.memberOf(ctx, userId);
    if (m.role.key === "owner" && !leaving && ctx.member.roleKey !== "owner") throw forbidden("Only an owner can remove an owner.");
    if (m.role.key === "owner" && !(await this.team.otherOwners(ctx, m.userId))) throw badRequest("A business needs at least one active owner.");
    // Their mailboxes stay with the business; they just can't open them any more.
    await this.write(ctx, (tx) => this.team.deleteMember(tx, m.id),
      () => ({ audit: { action: leaving ? "team.left" : "team.removed", target: m.user.email }, event: { name: "workspace.member.removed", payload: { userId: m.userId, left: leaving } } }));
    return { status: 200, message: leaving ? "You left the business." : `${m.user.userName} was removed.` };
  }

  // ───── Roles ─────
  async addRole(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.rolesAdmin(ctx);
    if (!ctx.entitlements.feature("custom_roles")) throw new AppError(402, "upgrade_needed", "Your own roles are part of the Business and Pro plans.");
    const b = roleBody.parse(raw);
    const key = `custom_${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)}_${Math.random().toString(36).slice(2, 6)}`;
    const perms = this.checkPerms(ctx, b.perms);
    const r = await this.write(ctx, (tx) => this.team.createRole(tx, { key, name: b.name, perms }),
      (r) => ({ audit: { action: "role.created", target: b.name }, event: { name: "workspace.role.created", payload: { id: r.id } } }));
    return { status: 200, message: `Role "${b.name}" created.`, data: { id: r.id } };
  }
  async editRole(ctx: BusinessContext, id: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.rolesAdmin(ctx);
    const b = roleBody.partial().parse(raw);
    const r = await this.team.role(ctx, id);
    if (!r) throw notFound("Role not found.");
    if (r.key === "owner") throw badRequest("The owner role always has every permission.");
    const perms = b.perms ? this.checkPerms(ctx, b.perms) : undefined;
    await this.write(ctx, (tx) => this.team.updateRole(tx, r.id, { name: b.name, perms }),
      () => ({ audit: { action: "role.updated", target: b.name ?? r.name ?? r.key }, event: { name: "workspace.role.updated", payload: { id: r.id } } }));
    return { status: 200, message: "Role saved." };
  }
  async deleteRole(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    this.rolesAdmin(ctx);
    const r = await this.team.roleWithCount(ctx, id);
    if (!r) throw notFound("Role not found.");
    if (r.system) throw badRequest("Built-in roles can't be deleted.");
    if (r._count.memberships) throw badRequest("Move the people in this role to another role first.");
    await this.write(ctx, (tx) => this.team.deleteRole(tx, r.id),
      () => ({ audit: { action: "role.deleted", target: r.name ?? r.key }, event: { name: "workspace.role.deleted", payload: { id: r.id } } }));
    return { status: 200, message: "Role deleted." };
  }
}
