// The rules of a business's branches and its own settings, on the kernel. Moved from business/backend/src/modules/branches/routes.ts and
// modules/settings/routes.ts (P2-W5/W6); every rule, message and audit string unchanged.
// Where it fits: WorkspaceController calls one method per route.
// How it works (branches): everyone sees the branches they work at; the business settings permissions manage them. Access points at the branch id, so a
// rename doesn't touch anyone's access; the old `scopes` names are rewritten from the links in the same transaction (rollback safety, ACCESS.md 3.4).
// How it works (settings): each section is saved whole in tenants.settings[section]. Secret values (the Khalti key) are sealed with SECRETS_KEY and only
// ever sent back as "••••••••"; sending that mask back keeps the saved key. A listing check-up moves the listing's next check date (by the business's
// "All correct keeps it live for" setting) or marks it sold, expired or removed; each one is in the audit log, which is also the check-ups history.
// Each change runs in ONE transaction with its audit line and its event.
// Rules: a business keeps at least one open branch; a branch with any work in it, or someone's only branch, can't be removed (close it instead); settings
// need the business settings permissions (check-up settings: those, or "assign leads"); check-ups need a listing role and only touch listings in view.

import { z } from "zod";
import type { ListingStatus, Prisma } from "@prisma/client";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BusinessEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import type { Vault } from "@sheetal/platform/auth/vault";
import { syncOldNames } from "@sheetal/platform/tenancy/branch-links";
import { worksAt } from "@sheetal/backend-core/domain/branches";
import { LISTING_PERMS } from "@sheetal/backend-core/domain/listings";
import { photoUrl, savePhoto } from "@sheetal/backend-core/lib/photos";
import { BranchRepository, SettingsRepository } from "./workspace.repository.js";

export const SETTINGS_PERM = "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete";
export const SECTIONS = ["payments", "notifications", "listings", "documents", "branding", "checkups"] as const;
type Section = (typeof SECTIONS)[number];
type Obj = Record<string, unknown>;
export const MASK = "••••••••";
/** Secret fields inside a section (path below the section). */
const SECRETS: Partial<Record<Section, string[][]>> = { payments: [["own", "khalti", "key"]] };
export const CHECKUP_DEFAULTS = { reviewers: "all" as "all" | string[], perDay: 5, askBeforeDays: 3, extendMonths: 3, overdue: "keep" as "keep" | "hide" };
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const getAt = (o: unknown, path: string[]): unknown => path.reduce<unknown>((x, k) => (isObj(x) ? x[k] : undefined), o);
function setAt(o: Obj, path: string[], v: unknown) { let x: Obj = o; for (const k of path.slice(0, -1)) { if (!isObj(x[k])) x[k] = {}; x = x[k] as Obj; } x[path[path.length - 1]!] = v; }
const addMonths = (d: Date, n: number) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const name = z.string().trim().min(2, "Give the branch a name.").max(60);
const text = (max: number) => z.string().trim().max(max).optional().nullable();
const fields = { address: text(200), phone: text(30), manager: text(80), receipt: text(80) };
const Checkups = z.object({
  reviewers: z.union([z.literal("all"), z.array(z.string().max(40)).max(500)]).default("all"), perDay: z.number().int().min(1).max(20).default(5),
  askBeforeDays: z.number().int().min(0).max(30).default(3), extendMonths: z.number().int().min(1).max(24).default(3), overdue: z.enum(["keep", "hide"]).default("keep"),
});
const LIVE_OR_DONE: ListingStatus[] = ["published", "sold", "rented", "paused", "expired"];

class BranchBase extends BaseRepository<BusinessEntity, never, never> {
  constructor() { super({ model: "branch", branchField: null, ownerField: null, label: "This branch", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "asc" }] }); }
}
export interface WorkspaceDeps { bus: EventBus; vault: Vault; mediaDir: string; mediaBase: string; catalog: () => Promise<unknown> }

export class WorkspaceService extends BaseService<BusinessEntity, never, never> {
  readonly branches = new BranchRepository();
  readonly settings = new SettingsRepository();
  constructor(private readonly x: WorkspaceDeps) {
    super({ app: "workspace", resource: "branch", repo: new BranchBase(), permissions: { read: SETTINGS_PERM, create: SETTINGS_PERM, update: SETTINGS_PERM, delete: SETTINGS_PERM },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "branch", label: (b) => b.id }, bus: x.bus, requireVersion: false });
  }
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => { audit: { action: string; target?: string; meta?: object }; event: { name: string; payload: object; branchId?: string | null } }): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      await this.writeAudit(tx, a.audit.action, a.audit.target as string, a.audit.meta);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1, { branchId: a.event.branchId ?? null });
      return r;
    });
  }
  private manage(ctx: BusinessContext) { if (!ctx.permissions.can(SETTINGS_PERM)) throw forbidden("Your role can't change branches."); }
  private async branchOf(ctx: BusinessContext, id: string) { const b = await this.branches.one(ctx, id); if (!b) throw notFound("Branch not found."); return b; }

  // ───── Branches ─────
  async branchList(ctx: BusinessContext) {
    const [rows, [rooms, listings, members]] = await Promise.all([this.branches.all(ctx), this.branches.usage(ctx)]);
    const allowed = ctx.branches.allowed;
    const mine = rows.filter((b) => allowed === "all" || allowed.includes(b.id));
    return {
      access: allowed === "all" ? "all" : mine.map((b) => b.name), accessIds: allowed === "all" ? "all" : [...allowed],
      branches: mine.map((b) => ({
        id: b.id, name: b.name, address: b.address, phone: b.phone, manager: b.manager, receipt: b.receipt, status: b.status, sort: b.sort, version: (b as { version?: number }).version,
        rooms: rooms.find((r) => r.branchId === b.id)?._count ?? 0, listings: listings.find((r) => r.branchId === b.id)?._count ?? 0,
        // People who work here: those limited to this branch, plus everyone with all branches.
        staff: members.filter((m) => worksAt(m, b.id, b.name)).length,
      })),
    };
  }
  async addBranch(ctx: BusinessContext, raw: unknown) {
    this.manage(ctx);
    const b = z.object({ name, ...fields }).parse(raw);
    if (await this.branches.named(ctx, b.name)) throw conflict(`There is already a branch called ${b.name}.`);
    const row = await this.write(ctx, async (tx) => this.branches.create(tx, { name: b.name, address: b.address, phone: b.phone, manager: b.manager, receipt: b.receipt, sort: await this.branches.count(tx) }),
      (r) => ({ audit: { action: "branch.added", target: b.name }, event: { name: "workspace.branch.added", payload: { id: r.id }, branchId: r.id } }));
    return { status: 201, message: `${b.name} added.`, data: { id: row.id } };
  }
  async editBranch(ctx: BusinessContext, id: string, raw: unknown) {
    this.manage(ctx);
    const b = z.object({ name: name.optional(), ...fields, status: z.enum(["open", "closed"]).optional(), sort: z.number().int().min(0).max(999).optional(), version: z.number().int().min(1).optional() }).parse(raw);
    const br = await this.branchOf(ctx, id);
    if (b.status === "closed" && br.status === "open" && !(await this.branches.count(ctx, { status: "open", id: { not: br.id } }))) throw badRequest("A business needs at least one open branch.");
    const renamed = b.name && b.name !== br.name ? b.name : null;
    if (renamed && (await this.branches.named(ctx, renamed, br.id))) throw conflict(`There is already a branch called ${renamed}.`);
    await this.write(ctx, async (tx) => {
      if (!(await this.branches.change(tx, br.id, { name: b.name, address: b.address, phone: b.phone, manager: b.manager, receipt: b.receipt, status: b.status, sort: b.sort }, b.version))) throw conflict("Someone else changed this branch. Reload to see the latest.");
      if (!renamed) return br;
      // Access is by branch id, so nothing changes for anyone; only the old names are rewritten from the links (rollback safety).
      const linked = await this.branches.linkedTo(tx, br.id);
      await syncOldNames(tx.tx as never, { memberships: linked.members, invites: linked.invites });
      return br;
    }, () => ({ audit: { action: renamed ? "branch.renamed" : b.status ? `branch.${b.status === "open" ? "reopened" : "closed"}` : "branch.updated", target: renamed ? `${br.name} → ${renamed}` : br.name }, event: { name: "workspace.branch.updated", payload: { id: br.id, status: b.status ?? br.status }, branchId: br.id } }));
    return { message: renamed ? `Renamed to ${renamed}.` : b.status === "closed" ? `${br.name} closed.` : b.status === "open" ? `${br.name} reopened.` : `${br.name} saved.` };
  }
  async removeBranch(ctx: BusinessContext, id: string) {
    this.manage(ctx);
    const br = await this.branchOf(ctx, id);
    if ((await this.branches.count(ctx)) <= 1) throw badRequest("A business needs at least one branch.");
    if (br.status === "open" && !(await this.branches.count(ctx, { status: "open", id: { not: br.id } }))) throw badRequest("A business needs at least one open branch.");
    const work = (await this.branches.work(ctx, br.id)).filter(([n]) => n).map(([n, w]) => `${n} ${n === 1 ? w : w === "enquiry" ? "enquiries" : `${w}s`}`);
    if (work.length) throw badRequest(`${br.name} has ${work.join(", ")}. Move them to another branch, or close the branch instead (its history stays).`);
    await this.write(ctx, async (tx) => {
      // Someone's only branch: a limited member whose link rows are exactly this branch.
      const only = await this.branches.onlyHere(tx, br.id);
      if (only.length) throw badRequest(`${only.map((m) => m.user.userName).join(", ")} only work${only.length > 1 ? "" : "s"} at ${br.name}. Give them another branch on the Team page first.`);
      const linked = await this.branches.linkedTo(tx, br.id);
      await this.branches.remove(tx, br.id);
      // The old names, rewritten from the links that are left. A pending invitation left with no branch becomes "all", as before.
      await syncOldNames(tx.tx as never, { memberships: linked.members, invites: linked.invites });
      return br;
    }, () => ({ audit: { action: "branch.removed", target: br.name }, event: { name: "workspace.branch.removed", payload: { id: br.id } } }));
    return { message: `${br.name} removed.` };
  }

  // ───── Settings ─────
  /** A section as the panel may see it: secrets replaced by the mask. */
  private masked(section: Section, value: unknown): Obj {
    const out = isObj(value) ? structuredClone(value) : {};
    for (const path of SECRETS[section] ?? []) if (getAt(out, path)) setAt(out, path, MASK);
    return out;
  }
  async readSettings(ctx: BusinessContext) {
    const s = await this.settings.read(ctx);
    return Object.fromEntries(SECTIONS.filter((k) => isObj(s[k])).map((k) => [k, this.masked(k, s[k])]));
  }
  async saveSection(ctx: BusinessContext, rawSection: string, raw: unknown) {
    const pick = z.enum(SECTIONS).safeParse(rawSection);
    if (!pick.success) throw notFound("No such settings.");
    const section = pick.data;
    const allowed = section === "checkups" ? ctx.permissions.can(SETTINGS_PERM) || ctx.permissions.can("crm.lead.assign") : ctx.permissions.can(SETTINGS_PERM);
    if (!allowed) throw forbidden("Your role can't change these settings.");
    let next: Obj = z.record(z.string().max(60), z.unknown()).refine((v) => JSON.stringify(v).length <= 20_000, "Too many settings.").parse(raw);
    if (section === "checkups") next = Checkups.parse(next);
    await this.write(ctx, async (tx) => {
      const cur = await this.settings.read(tx);
      for (const path of SECRETS[section] ?? []) {
        const v = getAt(next, path);
        if (v === MASK) setAt(next, path, getAt(cur[section], path) ?? "");
        else if (typeof v === "string" && v.trim()) setAt(next, path, this.x.vault.seal(v.trim()));
      }
      await this.settings.write(tx, { ...cur, [section]: next });
      return section;
    }, () => ({ audit: { action: `settings.${section}`, target: section }, event: { name: "workspace.settings.saved", payload: { section } } }));
    return { message: "Settings saved.", data: this.masked(section, next) };
  }
  async uploadQr(ctx: BusinessContext, raw: unknown) {
    if (!ctx.permissions.can(SETTINGS_PERM)) throw forbidden("Your role can't change payment settings.");
    const b = z.object({ data: z.string().min(16).max(27 * 1024 * 1024) }).parse(raw);
    const file = await savePhoto(this.x.mediaDir, Buffer.from(b.data, "base64"), "brand");
    return { url: photoUrl(this.x.mediaBase, "main", file, "brand") };
  }
  catalog() { return this.x.catalog(); }

  // ───── Listing check-ups ─────
  async checkup(ctx: BusinessContext, code: string, raw: unknown) {
    if (!LISTING_PERMS.some((p) => ctx.permissions.can(p))) throw forbidden("Your role can't check listings.");
    const b = z.object({ action: z.enum(["ok", "edit", "extend", "sold", "expire", "remove", "skip"]), months: z.number().int().min(1).max(24).optional() }).parse(raw);
    const l = await this.settings.listing(ctx, code);
    if (!l) throw notFound("Listing not found.");
    if (b.action !== "skip" && b.action !== "remove" && !LIVE_OR_DONE.includes(l.status)) throw badRequest("Only listings on the website are checked.");
    const cfg = { ...CHECKUP_DEFAULTS, ...Checkups.partial().parse((await this.settings.read(ctx)).checkups ?? {}) };
    const now = new Date();
    const data: Prisma.ListingUpdateInput = b.action === "skip" ? {} : { lastCheckedAt: now, lastCheckedBy: ctx.member.userId };
    let detail = "";
    if (b.action === "ok" || b.action === "edit") data.checkDueAt = addMonths(now, cfg.extendMonths);
    if (b.action === "extend") { data.checkDueAt = addMonths(now, b.months ?? cfg.extendMonths); detail = `Next check ${day(data.checkDueAt as Date)}.`; }
    if (b.action === "sold") data.status = l.purpose === "rent" ? "rented" : "sold";
    if (b.action === "expire") data.status = "expired";
    if (b.action === "remove") data.status = "removed";
    await this.write(ctx, async (tx) => { if (Object.keys(data).length) await this.settings.checkListing(tx, l.id, data); return l; },
      () => ({ audit: { action: `checkup.${b.action}`, target: l.code, meta: { title: l.title, detail } }, event: { name: "workspace.checkup.done", payload: { code: l.code, action: b.action }, branchId: l.branchId } }));
    return { message: b.action === "skip" ? "Skipped." : "Saved.", data: { checkDue: day((data.checkDueAt as Date | undefined) ?? l.checkDueAt), status: (data.status as string | undefined) ?? l.status } };
  }
  async checkupLog(ctx: BusinessContext) {
    const rows = await this.settings.checkupLog(ctx);
    const uids = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const users = new Map((await this.settings.userNames(ctx, uids)).map((u) => [u.id, u.userName]));
    return rows.map((r) => {
      const m = isObj(r.meta) ? r.meta : {};
      return { id: r.id, at: r.createdAt.toISOString(), listingId: r.target, title: typeof m.title === "string" ? m.title : r.target, action: r.action.slice("checkup.".length), by: users.get(r.actorId ?? "") ?? "Team member", detail: typeof m.detail === "string" ? m.detail : "" };
    });
  }
}
