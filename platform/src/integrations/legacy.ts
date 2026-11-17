// Keeps the OLD settings rows and the NEW connections in step, in both directions, for one release (INTEGRATIONS.md section 9).
// Where it fits:
//   importLegacy()  old rows -> connections. It is `npm run integrations:migrate` (idempotent, deletes nothing), and the old Admin -> Settings routes call it
//                   with { force: true } after they save, so they are true aliases of the Integration Center.
//   syncLegacy()    connection -> old row. The service calls it after every change to a platform connection, so the code that still reads the old rows
//                   (billing's gateways(), the website's Analytics tag, the old settings forms) sees what the Integration Center decided.
// How it works: the old rows are AppSetting "payments" ({ esewa, khalti, fonepay, manual }) and "integration.google|whatsapp|cloudflare". Sealed strings are
// COPIED AS THEY ARE on import (never opened). On the way back a value sealed in the bound format (v2) is opened and re-sealed in the old format, because
// the old readers do not know the binding.
// Rules: neither direction ever deletes a row. A connection that is not live writes "switched off" to the old row (apps behave as if it is not connected).
// "payments.manual" (bank transfer) is not an integration and is never touched.

import type { Prisma } from "@prisma/client";
import type { Vault } from "../auth/vault.js";
import type { Db } from "../db/client.js";
import type { Mode } from "./types.js";

export const LEGACY_GATEWAYS = ["esewa", "khalti", "fonepay"] as const;
export const LEGACY_WEB = ["google", "whatsapp", "cloudflare"] as const;
const WEB_SECRETS: Record<string, string[]> = { google: ["mapsKey", "signInClientSecret"], whatsapp: ["token"], cloudflare: ["apiToken"] };
const GATEWAY_FIELDS: Record<string, string[]> = { esewa: ["productCode"], khalti: [], fonepay: ["merchantCode"] };
export const isLegacyId = (id: string) => (LEGACY_GATEWAYS as readonly string[]).includes(id) || (LEGACY_WEB as readonly string[]).includes(id);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const setting = async (db: Db, key: string): Promise<Json> => obj((await db.appSetting.findUnique({ where: { key } }))?.value);
const saveSetting = (db: Db, key: string, value: Json) => db.appSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });

export interface ImportReport { id: string; result: "created" | "refreshed" | "skipped"; why: string }

/** What a connection should be, read from the old row. null = the old row holds nothing for it. */
async function fromLegacy(db: Db, id: string): Promise<null | { state: string; mode: Mode; config: Record<string, string>; sealed: Record<string, string>; lastTest: { at: Date; ok: boolean } | null; degraded: boolean; pauseReason: string | null }> {
  if ((LEGACY_GATEWAYS as readonly string[]).includes(id)) {
    const g = obj((await setting(db, "payments"))[id]);
    const key = str(g.secretKey);
    if (!key) return null;
    const mode: Mode = g.mode === "live" ? "live" : "test";
    const config: Record<string, string> = {};
    for (const f of GATEWAY_FIELDS[id] ?? []) { const v = str(g[f]); if (v) config[f] = v; }
    const on = g.enabled === true;
    return { state: on ? (mode === "live" ? "live" : "details_entered") : "paused", mode, config, sealed: { secretKey: key }, lastTest: null, degraded: false, pauseReason: on ? null : "Switched off in the old payment settings." };
  }
  const row = await setting(db, `integration.${id}`);
  const secrets = WEB_SECRETS[id] ?? [];
  const config: Record<string, string> = {}; const sealed: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "lastTest") continue;
    const s = str(v);
    if (!s) continue;
    if (secrets.includes(k)) sealed[k] = s; else config[k] = s;
  }
  const real = Object.keys(config).filter((k) => k !== "mode" && k !== "qrStatus").length + Object.keys(sealed).length;
  if (!real) return null;
  const lt = obj(row.lastTest);
  const at = str(lt.at) ? new Date(String(lt.at)) : null;
  const lastTest = at && !Number.isNaN(at.getTime()) ? { at, ok: lt.ok === true } : null;
  // In use today (the website adds the Analytics tag as soon as the id is saved), so it arrives live. A failed last test shows as "degraded"; nothing stops.
  return { state: "live", mode: "live", config, sealed, lastTest, degraded: !!lastTest && !lastTest.ok, pauseReason: null };
}

/**
 * Old rows -> platform connections. Without `force` an existing connection is left alone (safe to run again and again). With `force` (the old settings
 * routes, right after they saved) the connection is refreshed from the old row.
 */
export async function importLegacy(db: Db, o: { only?: string; force?: boolean; actorId?: string | null } = {}): Promise<ImportReport[]> {
  const ids = [...LEGACY_GATEWAYS, ...LEGACY_WEB].filter((id) => !o.only || o.only === id);
  const out: ImportReport[] = [];
  for (const id of ids) {
    const want = await fromLegacy(db, id);
    const have = await db.integrationConnection.findUnique({ where: { integrationId_ownerKey: { integrationId: id, ownerKey: "platform" } } });
    if (!want) {
      if (have && o.force && have.state !== "draft") {
        // The old form was emptied: the connection follows (its keys are removed, like a disconnect).
        await db.$transaction([
          db.integrationSecretSet.deleteMany({ where: { connectionId: have.id } }),
          db.integrationConnection.update({ where: { id: have.id }, data: { state: "draft", config: {}, lastTestAt: null, lastTestOk: null, healthStatus: "unknown", version: { increment: 1 } } }),
        ]);
        out.push({ id, result: "refreshed", why: "the old settings are empty now" });
      } else out.push({ id, result: "skipped", why: "nothing saved in the old settings" });
      continue;
    }
    if (have && !o.force) { out.push({ id, result: "skipped", why: "a connection already exists" }); continue; }
    const data = {
      state: want.state, mode: want.mode, config: want.config as Prisma.InputJsonValue,
      lastTestAt: want.lastTest?.at ?? null, lastTestOk: want.lastTest?.ok ?? null,
      healthStatus: want.degraded ? "degraded" : "unknown", healthMessage: want.degraded ? "The last test in the old settings failed." : null,
      pauseReason: want.pauseReason, pausedAt: want.state === "paused" ? new Date() : null,
    };
    await db.$transaction(async (tx) => {
      const row = have
        ? await tx.integrationConnection.update({ where: { id: have.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.integrationConnection.create({ data: { integrationId: id, scope: "platform", tenantId: null, ownerKey: "platform", createdBy: o.actorId ?? null, goLiveAt: want.state === "live" ? new Date() : null, ...data } });
      await tx.integrationSecretSet.deleteMany({ where: { connectionId: row.id, mode: want.mode, status: { in: ["active", "staged"] } } });
      if (Object.keys(want.sealed).length) {
        // The sealed strings are copied as they are: never opened here.
        await tx.integrationSecretSet.create({ data: { connectionId: row.id, mode: want.mode, status: "active", sealed: want.sealed as Prisma.InputJsonValue, fieldNames: Object.keys(want.sealed) as Prisma.InputJsonValue, createdBy: o.actorId ?? null } });
      }
      if (!have && want.lastTest) {
        await tx.integrationTestLog.create({ data: { connectionId: row.id, kind: "test", mode: want.mode, ok: want.lastTest.ok, at: want.lastTest.at, checks: [{ name: "Earlier test", ok: want.lastTest.ok, message: "Carried over from the old settings screen." }] as Prisma.InputJsonValue } });
      }
    });
    out.push({ id, result: have ? "refreshed" : "created", why: `${want.state}, ${want.mode} mode` });
  }
  return out;
}

/** Connection -> old row, after a change in the Integration Center. Only for platform connections of the six old ids; anything else is ignored. */
export async function syncLegacy(db: Db, vault: Vault, connectionId: string): Promise<void> {
  const row = await db.integrationConnection.findUnique({ where: { id: connectionId }, include: { secrets: { where: { status: "active" } } } });
  if (!row || row.scope !== "platform" || !isLegacyId(row.integrationId)) return;
  const id = row.integrationId;
  const mode = row.mode as Mode;
  const sealed = obj(row.secrets.find((s) => s.mode === mode)?.sealed);
  /** The value in the old format: a v1 string stays as it is; a bound (v2) one is opened and sealed again without the binding. */
  const oldFormat = (field: string): string | undefined => {
    const v = str(sealed[field]);
    if (!v) return undefined;
    if (v.startsWith("v1:")) return v;
    try { return vault.seal(vault.open(v, `${row.id}:${mode}:${field}`)); } catch { return undefined; }
  };
  const config = obj(row.config) as Record<string, string>;
  if ((LEGACY_GATEWAYS as readonly string[]).includes(id)) {
    const all = await setting(db, "payments");
    const key = oldFormat("secretKey");
    const on = !!key && (row.state === "live" || (mode === "test" && (row.state === "details_entered" || row.state === "test_passed")));
    const fields: Json = {};
    for (const f of GATEWAY_FIELDS[id] ?? []) if (config[f]) fields[f] = config[f];
    // No key (disconnected): the entry is removed, which is exactly "never set up" for the old reader (eSewa's public test merchant works again locally).
    if (key) all[id] = { enabled: on, mode, ...fields, secretKey: key }; else delete all[id];
    await saveSetting(db, "payments", all);
    return;
  }
  const live = row.state === "live";
  const next: Json = {};
  if (live) {
    Object.assign(next, config);
    for (const f of WEB_SECRETS[id] ?? []) { const v = oldFormat(f); if (v) next[f] = v; }
    if (row.lastTestAt && row.lastTestOk !== null) next.lastTest = { at: row.lastTestAt.toISOString(), ok: row.lastTestOk };
  }
  await saveSetting(db, `integration.${id}`, next);
}
