// Platform settings and the Google, WhatsApp and Cloudflare connections, for Sheetal staff.
// Where it fits: Admin → Settings (GET/PUT /admin/settings/platform) and Admin → Setup center (GET/PUT
// /admin/settings/integrations/:id, POST .../test). The values themselves live in backend-core/src/domain/platform.ts.
// How it works: every change is checked with zod (bad values are 422), compared with what is saved, and written to the
// audit log as one row per field with old → new. Keys and tokens are sealed with the Vault and never sent back (the
// page only learns hasSecret). "Test" calls the provider with the saved keys; tests pass a fake fetch.
// Rules: settings.platform for everything; security fields (login attempts, session days) and maintenance mode are
// super admin only, and so are all integration keys. Secrets never appear in the audit log.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import { Vault } from "@sheetal/platform/auth/vault";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import {
  INTEGRATION_IDS, SECRET_FIELDS, SUPER_ONLY, integrationSettings, openSecret, platformSettings, saveIntegration, savePlatform,
  type IntegrationId, type PlatformSettings,
} from "@sheetal/backend-core/domain/platform";
import { staffOf } from "./routes.js";
import { importLegacy } from "@sheetal/platform/integrations/legacy";

const domain = z.string().trim().toLowerCase().max(120).regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(\/[a-z0-9._-]*)*$/, "Write it like sheetalproperty.com, with no https://.");
const platformBody = z.strictObject({
  siteName: z.string().trim().min(2, "Give the site a name.").max(80),
  supportEmail: z.email("Enter a valid email address."),
  supportPhone: z.string().trim().max(30).regex(/^[+\d\s()-]*$/, "Use digits, spaces, + and - only."),
  domains: z.strictObject({ site: domain, business: domain, admin: domain }).partial(),
  vatRate: z.number().min(0, "VAT can't be below 0.").max(30, "VAT can't be above 30."),
  commissionPct: z.number().min(0).max(50, "Commission can't be above 50."),
  languages: z.array(z.enum(["en", "ne"])).min(1, "Keep at least one language on."),
  trialDays: z.number().int().min(0).max(90),
  graceDays: z.number().int().min(0).max(60),
  autoSuspend: z.boolean(),
  maxLoginAttempts: z.number().int().min(3, "At least 3 attempts.").max(20),
  sessionDays: z.number().int().min(1).max(90),
  loginCode: z.boolean(),
  maintenance: z.strictObject({ on: z.boolean(), message: z.string().trim().max(300) }).partial(),
}).partial();

/** Flattens settings so a change can be shown as "vatRate: 13 → 15". */
function flat(s: object, prefix = ""): Record<string, unknown> {
  return Object.entries(s).reduce<Record<string, unknown>>((o, [k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? { ...o, ...flat(v, `${prefix}${k}.`) } : { ...o, [`${prefix}${k}`]: v }), {});
}
const show = (v: unknown) => (Array.isArray(v) ? v.join(",") : v === "" ? "(empty)" : String(v));

const secretKey = z.string().trim().min(8, "That key looks too short.").max(400);
const BODIES = {
  google: z.strictObject({
    measurementId: z.string().trim().regex(/^(G-[A-Z0-9]{4,20})?$/, "A Google Analytics id looks like G-ABC123XYZ.").optional(),
    searchConsoleToken: z.string().trim().regex(/^([A-Za-z0-9_-]{10,100})?$/, "Paste only the token from the verification tag (letters, numbers, - and _).").optional(),
    mapsKey: secretKey.optional(),
  }),
  whatsapp: z.strictObject({
    mode: z.enum(["cloud", "qr"]).optional(),
    phoneId: z.string().trim().regex(/^(\d{5,20})?$/, "The phone number id is digits only.").optional(),
    token: secretKey.optional(),
    qrStatus: z.enum(["not_paired", "waiting", "paired"]).optional(),
  }),
  cloudflare: z.strictObject({
    zoneId: z.string().trim().toLowerCase().regex(/^([a-f0-9]{32})?$/, "A zone id is 32 letters and numbers (a–f, 0–9).").optional(),
    apiToken: secretKey.optional(),
  }),
} satisfies Record<IntegrationId, z.ZodType>;

const idOf = (request: { params: unknown }): IntegrationId => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  if (!(INTEGRATION_IDS as readonly string[]).includes(id)) throw notFound("There is no such connection.");
  return id as IntegrationId;
};

interface Check { name: string; ok: boolean; message: string }
const errText = async (res: Response) => { try { const j = (await res.json()) as { error?: { message?: string }; errors?: { message?: string }[]; error_message?: string }; return j.error?.message ?? j.errors?.[0]?.message ?? j.error_message ?? `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; } };

export async function adminPlatformRoutes(app: FastifyInstance, opts: { fetch?: Fetch } = {}) {
  const db = () => dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const call: Fetch = (url, init) => (opts.fetch ?? fetch)(url, { signal: AbortSignal.timeout(10_000), ...init });
  const audit = (actorId: string, ip: string, action: string, target: string, meta?: object) => db().auditLog.create({ data: { actorId, action, target, ip, meta: meta as object | undefined } });

  // ───── Platform settings ─────
  app.get("/admin/settings/platform", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    return { data: { ...(await platformSettings(db())), canChangeSecurity: s.role === "super_admin" } };
  });

  app.put("/admin/settings/platform", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    const b = platformBody.parse(request.body);
    const cur = await platformSettings(db());
    const next: PlatformSettings = { ...cur, ...b, domains: { ...cur.domains, ...(b.domains ?? {}) }, maintenance: { ...cur.maintenance, ...(b.maintenance ?? {}) } } as PlatformSettings;
    const before = flat(cur), after = flat(next);
    const changed = Object.keys(after).filter((k) => show(before[k]) !== show(after[k]));
    const locked = changed.filter((k) => (SUPER_ONLY as readonly string[]).includes(k.split(".")[0]!));
    if (locked.length && s.role !== "super_admin") throw forbidden("Only the super admin can change security settings or maintenance mode.");
    if (!changed.length) return { message: "Nothing changed.", data: next };
    await savePlatform(db(), b as Partial<PlatformSettings>);
    for (const k of changed) await audit(s.user.id, request.ip, "settings.platform", `${k}: ${show(before[k])} → ${show(after[k])}`, { field: k, from: before[k], to: after[k] });
    return { message: "Settings saved.", data: next };
  });

  // ───── Integrations (Google, WhatsApp, Cloudflare) ─────
  const view = async (id: IntegrationId) => {
    const cur = (await integrationSettings(db(), id)) as Record<string, unknown>;
    const secrets = SECRET_FIELDS[id];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cur)) if (!secrets.includes(k) && k !== "lastTest") out[k] = v;
    for (const k of secrets) out[`has${k[0]!.toUpperCase()}${k.slice(1)}`] = !!cur[k];
    const set = Object.entries(cur).filter(([k, v]) => k !== "lastTest" && k !== "mode" && k !== "qrStatus" && !!v).length;
    const lastTest = (cur.lastTest ?? null) as { at: string; ok: boolean } | null;
    return { ...out, lastTest, status: !set ? "off" : lastTest?.ok ? "done" : "review" };
  };

  app.get("/admin/settings/integrations/:id", async (request) => {
    staffOf(request, "platform.settings.read+platform.settings.update");
    return { data: await view(idOf(request)) };
  });

  app.put("/admin/settings/integrations/:id", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    if (s.role !== "super_admin") throw forbidden("Only the super admin can change connection keys.");
    const id = idOf(request);
    const b = BODIES[id].parse(request.body) as Record<string, string | undefined>;
    const cur = (await integrationSettings(db(), id)) as Record<string, string | undefined>;
    const next: Record<string, unknown> = { ...cur };
    const changes: string[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      if (SECRET_FIELDS[id].includes(k)) { next[k] = vault.seal(v); changes.push(`${k}: key replaced`); continue; }
      if ((cur[k] ?? "") !== v) { next[k] = v; changes.push(`${k}: ${cur[k] || "(empty)"} → ${v || "(empty)"}`); }
    }
    if (!changes.length) return { message: "Nothing changed.", data: await view(id) };
    delete next.lastTest; // the keys changed, so the last test no longer counts
    await saveIntegration(db(), id, next);
    for (const c of changes) await audit(s.user.id, request.ip, `settings.integration.${id}`, c);
    // This old route is an alias of the Integration Center now: its connection follows what was just saved (platform/src/integrations/legacy.ts).
    await importLegacy(db(), { only: id, force: true, actorId: s.user.id });
    return { message: "Saved. Press Test to check it.", data: await view(id) };
  });

  app.post("/admin/settings/integrations/:id/test", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    const id = idOf(request);
    const cur = (await integrationSettings(db(), id)) as Record<string, string | undefined>;
    const checks: Check[] = [];
    const missing = id === "google" ? (!cur.measurementId && !cur.mapsKey && !cur.searchConsoleToken && "Save at least one Google value first.")
      : id === "whatsapp" ? (cur.mode !== "qr" && (!cur.phoneId || !cur.token) && "Save the phone number id and the token first.")
      : !cur.apiToken && "Save the API token first.";
    if (missing) throw badRequest(missing);
    try {
      if (id === "google") {
        if (cur.measurementId) checks.push({ name: "Analytics id", ok: true, message: "Saved. Google gives no way to check it from here; open Analytics → Realtime to see visits." });
        if (cur.searchConsoleToken) checks.push({ name: "Search Console", ok: true, message: "Saved. In Search Console press Verify once the site shows the tag." });
        if (cur.mapsKey) {
          const res = await call(`https://maps.googleapis.com/maps/api/geocode/json?address=Kathmandu&key=${encodeURIComponent(openSecret(vault, cur.mapsKey)!)}`);
          const j = (await res.json()) as { status?: string; error_message?: string };
          checks.push({ name: "Maps key", ok: j.status === "OK", message: j.status === "OK" ? "Google Maps accepted the key." : j.error_message ?? `Google answered ${j.status ?? res.status}.` });
        }
      } else if (id === "whatsapp") {
        if (cur.mode === "qr") checks.push({ name: "QR pairing", ok: false, message: "QR pairing isn't available yet. Use the Cloud API." });
        else {
          const res = await call(`https://graph.facebook.com/v21.0/${cur.phoneId}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${openSecret(vault, cur.token)}` } });
          if (res.ok) { const j = (await res.json()) as { display_phone_number?: string; verified_name?: string }; checks.push({ name: "WhatsApp Cloud API", ok: true, message: `Connected to ${j.verified_name ?? "your number"}${j.display_phone_number ? ` (${j.display_phone_number})` : ""}.` }); }
          else checks.push({ name: "WhatsApp Cloud API", ok: false, message: await errText(res) });
        }
      } else {
        const headers = { authorization: `Bearer ${openSecret(vault, cur.apiToken)}` };
        const v = await call("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers });
        checks.push({ name: "API token", ok: v.ok, message: v.ok ? "Cloudflare accepted the token." : await errText(v) });
        if (cur.zoneId) {
          const z = await call(`https://api.cloudflare.com/client/v4/zones/${cur.zoneId}`, { headers });
          if (z.ok) { const j = (await z.json()) as { result?: { name?: string } }; checks.push({ name: "Zone", ok: true, message: `Found ${j.result?.name ?? "the zone"}.` }); }
          else checks.push({ name: "Zone", ok: false, message: await errText(z) });
        }
      }
    } catch {
      checks.push({ name: "Connection", ok: false, message: "Couldn't reach the service. Check the internet and try again." });
    }
    const ok = checks.length > 0 && checks.every((c) => c.ok);
    await saveIntegration(db(), id, { ...cur, lastTest: { at: new Date().toISOString(), ok } });
    await audit(s.user.id, request.ip, `settings.integration.${id}.test`, ok ? "passed" : "failed");
    await importLegacy(db(), { only: id, force: true, actorId: s.user.id });
    return { data: { ok, checks } };
  });
}
