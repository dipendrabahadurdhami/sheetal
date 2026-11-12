// The typed settings store: read, change, reset and the history of a setting (SETTINGS.md section 2.2).
// Where it fits: routes.ts (the admin settings screens), revenue.ts (the commission rule) and any service that needs a setting. Nobody else reads or writes
// the AppSetting table for a key declared in defs.ts.
// How it works: a platform value is the AppSetting row with the definition's key; a business value is the row "t:<businessId>:<key>". A read gives the
// stored value checked by the schema, or the default (a bad stored value is logged and the default is used: a read never fails). A write validates, runs the
// definition's guard, and saves the row and an audit row in one transaction. Reads are cached for 30 seconds in this process and cleared by a write here.
// Rules: the business id in a key only ever comes from the `owner` argument the caller built from the signed-in context, never from request input.
// The audit row lists the changed top-level field names (and the reason when one is required), not the values, unless the definition says "values".

import type { Prisma } from "@prisma/client";
import { AppError, badRequest } from "../core/errors.js";
import type { Db } from "../db/client.js";
import type { SettingChange, SettingDef } from "./types.js";

export interface SettingOwner { tenantId: string | null }
export interface SettingActor { actorId: string | null; ip?: string | null; reason?: string }
export const PLATFORM_OWNER: SettingOwner = { tenantId: null };
const TTL_MS = 30_000;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** The top-level field names that differ between two values (or ["value"] when they are not objects). */
export function changedFields(prev: unknown, next: unknown): string[] {
  if (!isObject(prev) || !isObject(next)) return JSON.stringify(prev) === JSON.stringify(next) ? [] : ["value"];
  return [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k])).sort();
}

export class SettingsService {
  private cache = new Map<string, { at: number; value: unknown; stored: boolean }>();
  constructor(private readonly db: Db, private readonly log: { warn(o: object, msg?: string): void }, private readonly now: () => number = Date.now) {}

  private rowKey(def: Pick<SettingDef, "key" | "scope">, owner: SettingOwner): string {
    if (def.scope === "platform") return def.key;
    if (!owner.tenantId || !/^[A-Za-z0-9_-]{6,60}$/.test(owner.tenantId)) throw badRequest("This setting belongs to a business.");
    return `t:${owner.tenantId}:${def.key}`;
  }

  private async read<T>(def: SettingDef<T>, owner: SettingOwner): Promise<{ value: T; stored: boolean }> {
    const key = this.rowKey(def, owner);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < TTL_MS) return { value: hit.value as T, stored: hit.stored };
    const row = await this.db.appSetting.findUnique({ where: { key } });
    let value = def.default; let stored = false;
    if (row) {
      const parsed = def.schema.safeParse(row.value);
      if (parsed.success) { value = parsed.data; stored = true; }
      else this.log.warn({ key: def.key }, "settings: a stored value does not fit its definition; the default is used");
    }
    this.cache.set(key, { at: this.now(), value, stored });
    return { value, stored };
  }

  /** The value in use: the stored one, or the default. Never throws on a bad stored value. */
  async get<T>(def: SettingDef<T>, owner: SettingOwner = PLATFORM_OWNER): Promise<T> { return (await this.read(def, owner)).value; }
  /** The value with whether it is stored ("Using the default" on the screen). */
  view<T>(def: SettingDef<T>, owner: SettingOwner = PLATFORM_OWNER) { return this.read(def, owner); }

  async set<T>(def: SettingDef<T>, value: unknown, who: SettingActor, owner: SettingOwner = PLATFORM_OWNER): Promise<T> {
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (errors[i.path.join(".") || "_"] ??= []).push(i.message);
      throw new AppError(422, "validation", "Please check the highlighted fields.", errors);
    }
    const reason = (who.reason ?? "").trim();
    if (def.needsReason && (reason.length < 5 || reason.length > 300)) throw badRequest("Give a reason of 5 to 300 characters for this change.");
    const key = this.rowKey(def, owner);
    this.cache.delete(key);
    const prev = (await this.read(def, owner)).value;
    const refused = def.guard?.(parsed.data, prev);
    if (refused) throw badRequest(refused);
    const fields = changedFields(prev, parsed.data);
    if (!fields.length) return parsed.data;
    const json = parsed.data as unknown as Prisma.InputJsonValue;
    const meta = { fields, ...(def.needsReason ? { reason } : {}), ...(def.audit === "values" ? { value: json } : {}) } as Prisma.InputJsonValue;
    await this.db.$transaction([
      this.db.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } }),
      this.db.auditLog.create({ data: { tenantId: owner.tenantId, actorId: who.actorId, action: `settings.${def.key}`, target: def.label.en, ip: who.ip ?? null, meta } }),
    ]);
    this.cache.delete(key);
    return parsed.data;
  }

  /** Forgets the stored value, so the default applies again. */
  async reset(def: Pick<SettingDef, "key" | "scope" | "label">, who: SettingActor, owner: SettingOwner = PLATFORM_OWNER): Promise<void> {
    const key = this.rowKey(def, owner);
    const had = await this.db.appSetting.findUnique({ where: { key }, select: { key: true } });
    this.cache.delete(key);
    if (!had) return;
    await this.db.$transaction([
      this.db.appSetting.delete({ where: { key } }),
      this.db.auditLog.create({ data: { tenantId: owner.tenantId, actorId: who.actorId, action: `settings.${def.key}`, target: def.label.en, ip: who.ip ?? null, meta: { fields: ["reset to default"] } } }),
    ]);
  }

  /** The last changes, newest first: who, when, which fields (from the audit log). */
  async history(def: Pick<SettingDef, "key">, owner: SettingOwner = PLATFORM_OWNER, limit = 20): Promise<SettingChange[]> {
    const rows = await this.db.auditLog.findMany({ where: { action: `settings.${def.key}`, tenantId: owner.tenantId }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100) });
    return rows.map((r) => {
      const meta = isObject(r.meta) ? r.meta : {};
      return { at: r.createdAt, actorId: r.actorId, fields: Array.isArray(meta.fields) ? meta.fields.filter((f): f is string => typeof f === "string") : [], reason: typeof meta.reason === "string" ? meta.reason : null };
    });
  }
}
