// A business's own settings that are not columns of the business (payments, notifications, listing defaults,
// documents, receipts, listing check-ups), the payment QR upload, the listing options (GET /catalog), and the
// listing check-up actions with their history.
// Where it fits: Business → Settings tabs, Listing check-ups, and the listing wizard's options.
// How it works: each section is saved whole in tenants.settings[section]. Secret values (the Khalti key) are sealed
// with SECRETS_KEY and only ever sent back as "••••••••"; sending that mask back keeps the saved key. A check-up moves
// the listing's next check date (by the business's "All correct keeps it live for" setting) or marks it sold,
// expired or removed; each one is written to the audit log, which is also the check-ups history.
// Rules: settings need settings.business (check-up settings: settings.business or leads.assign); check-ups need a
// listing role and only touch listings on the person's branches.

import type { FastifyInstance } from "fastify";
import type { ListingStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { cached } from "@sheetal/backend-core/lib/cache";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { readCatalog } from "@sheetal/backend-core/lib/catalog";
import { mediaBase, photoUrl, savePhoto } from "@sheetal/backend-core/lib/photos";
import { LISTING_PERMS } from "@sheetal/backend-core/domain/listings";
import { branchView, inView, workspaceOf } from "../access.js";

export const SECTIONS = ["payments", "notifications", "listings", "documents", "branding", "checkups"] as const;
type Section = (typeof SECTIONS)[number];
type Obj = Record<string, unknown>;
export const MASK = "••••••••";
/** Secret fields inside a section (path below the section). */
const SECRETS: Partial<Record<Section, string[][]>> = { payments: [["own", "khalti", "key"]] };
export const CHECKUP_DEFAULTS = { reviewers: "all" as "all" | string[], perDay: 5, askBeforeDays: 3, extendMonths: 3, overdue: "keep" as "keep" | "hide" };

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const getAt = (o: unknown, path: string[]): unknown => path.reduce<unknown>((x, k) => (isObj(x) ? x[k] : undefined), o);
function setAt(o: Obj, path: string[], v: unknown) {
  let x: Obj = o;
  for (const k of path.slice(0, -1)) { if (!isObj(x[k])) x[k] = {}; x = x[k] as Obj; }
  x[path[path.length - 1]!] = v;
}
const addMonths = (d: Date, n: number) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

const Checkups = z.object({
  reviewers: z.union([z.literal("all"), z.array(z.string().max(40)).max(500)]).default("all"),
  perDay: z.number().int().min(1).max(20).default(5),
  askBeforeDays: z.number().int().min(0).max(30).default(3),
  extendMonths: z.number().int().min(1).max(24).default(3),
  overdue: z.enum(["keep", "hide"]).default("keep"),
});

export async function settingsRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const stored = async (tenantId: string): Promise<Obj> => {
    const t = await db().tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    return isObj(t?.settings) ? (t!.settings as Obj) : {};
  };
  /** A section as the panel may see it: secrets replaced by the mask. */
  const masked = (section: Section, value: unknown): Obj => {
    const out = isObj(value) ? structuredClone(value) : {};
    for (const path of SECRETS[section] ?? []) if (getAt(out, path)) setAt(out, path, MASK);
    return out;
  };

  app.get("/workspace/settings", async (request) => {
    const ws = workspaceOf(request);
    const s = await stored(ws.tenantId);
    return { data: Object.fromEntries(SECTIONS.filter((k) => isObj(s[k])).map((k) => [k, masked(k, s[k])])) };
  });

  app.put<{ Params: { section: string } }>("/workspace/settings/:section", async (request) => {
    const ws = workspaceOf(request);
    const pick = z.enum(SECTIONS).safeParse(request.params.section);
    if (!pick.success) throw notFound("No such settings.");
    const section = pick.data;
    const allowed = section === "checkups" ? ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete") || ws.can("crm.lead.assign") : ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete");
    if (!allowed) throw forbidden("Your role can't change these settings.");
    let next: Obj = z.record(z.string().max(60), z.unknown()).refine((v) => JSON.stringify(v).length <= 20_000, "Too many settings.").parse(request.body);
    if (section === "checkups") next = Checkups.parse(next);
    const cur = await stored(ws.tenantId);
    for (const path of SECRETS[section] ?? []) {
      const v = getAt(next, path);
      if (v === MASK) setAt(next, path, getAt(cur[section], path) ?? "");
      else if (typeof v === "string" && v.trim()) setAt(next, path, vault.seal(v.trim()));
    }
    await db().tenant.update({ where: { id: ws.tenantId }, data: { settings: { ...cur, [section]: next } as Prisma.InputJsonValue } });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: `settings.${section}`, target: section, ip: request.ip } });
    return { message: "Settings saved.", data: masked(section, next) };
  });

  // A payment QR (Fonepay or bank) shown to customers when they pay.
  app.post("/workspace/settings/qr", { bodyLimit: 28 * 1024 * 1024 }, async (request) => {
    const ws = workspaceOf(request);
    if (!ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete")) throw forbidden("Your role can't change payment settings.");
    const b = z.object({ data: z.string().min(16).max(27 * 1024 * 1024) }).parse(request.body);
    const file = await savePhoto(app.config.MEDIA_DIR, Buffer.from(b.data, "base64"), "brand");
    return { data: { url: photoUrl(mediaBase(app.config), "main", file, "brand") } };
  });

  // The options Sheetal staff changed in Admin → Listing setup (the panel lays them over its built-in list).
  app.get("/catalog", async () => ({ data: await cached(app.cache, "catalog:stored", 60, () => readCatalog(db())) }));

  // ───── Listing check-ups ─────
  const LIVE_OR_DONE: ListingStatus[] = ["published", "sold", "rented", "paused", "expired"];
  app.post<{ Params: { code: string } }>("/listings/:code/checkup", async (request) => {
    const ws = workspaceOf(request);
    if (!LISTING_PERMS.some(ws.can)) throw forbidden("Your role can't check listings.");
    const b = z.object({ action: z.enum(["ok", "edit", "extend", "sold", "expire", "remove", "skip"]), months: z.number().int().min(1).max(24).optional() }).parse(request.body);
    const v = await branchView(db(), request, ws);
    const l = await db().listing.findFirst({ where: { code: request.params.code.slice(0, 40), tenantId: ws.tenantId, status: { not: "removed" }, ...inView(v) } });
    if (!l) throw notFound("Listing not found.");
    if (b.action !== "skip" && b.action !== "remove" && !LIVE_OR_DONE.includes(l.status)) throw badRequest("Only listings on the website are checked.");
    const cfg = { ...CHECKUP_DEFAULTS, ...Checkups.partial().parse((await stored(ws.tenantId)).checkups ?? {}) };
    const now = new Date();
    const data: Prisma.ListingUpdateInput = b.action === "skip" ? {} : { lastCheckedAt: now, lastCheckedBy: ws.user.id };
    let detail = "";
    if (b.action === "ok" || b.action === "edit") data.checkDueAt = addMonths(now, cfg.extendMonths);
    if (b.action === "extend") { data.checkDueAt = addMonths(now, b.months ?? cfg.extendMonths); detail = `Next check ${day(data.checkDueAt as Date)}.`; }
    if (b.action === "sold") data.status = l.purpose === "rent" ? "rented" : "sold";
    if (b.action === "expire") data.status = "expired";
    if (b.action === "remove") data.status = "removed";
    if (Object.keys(data).length) await db().listing.update({ where: { id: l.id }, data });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: `checkup.${b.action}`, target: l.code, ip: request.ip, meta: { title: l.title, detail } } });
    return { message: b.action === "skip" ? "Skipped." : "Saved.", data: { checkDue: day((data.checkDueAt as Date | undefined) ?? l.checkDueAt), status: (data.status as string | undefined) ?? l.status } };
  });

  app.get("/checkups/log", async (request) => {
    const ws = workspaceOf(request);
    const rows = await db().auditLog.findMany({ where: { tenantId: ws.tenantId, action: { startsWith: "checkup." } }, orderBy: { createdAt: "desc" }, take: 300 });
    const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const users = new Map((await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, userName: true } })).map((u) => [u.id, u.userName]));
    return {
      data: rows.map((r) => {
        const m = isObj(r.meta) ? r.meta : {};
        return { id: r.id, at: r.createdAt.toISOString(), listingId: r.target, title: typeof m.title === "string" ? m.title : r.target, action: r.action.slice("checkup.".length), by: users.get(r.actorId ?? "") ?? "Team member", detail: typeof m.detail === "string" ? m.detail : "" };
      }),
    };
  });
}
