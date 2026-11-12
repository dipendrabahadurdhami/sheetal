// Google, WhatsApp Cloud API and Cloudflare as integrations (INTEGRATIONS.md section 13, rows 7, 9, 10).
// Where it fits: platform scope, set up by the super admin. The checks are the ones Admin -> Settings ran before (admin/backend/src/modules/platform.ts),
// with the same words; the field patterns are the ones its request bodies had.
// Rules: read-only probes; a provider's error text goes through safeMessage() before it is stored or shown.

import { check, safeMessage } from "../fields.js";
import type { IntegrationContext, IntegrationSpec, TestResult } from "../types.js";
import { BaseIntegration, USUAL_STEPS, probe } from "./base.js";

const web = { scopes: ["platform"], modes: ["live"], documents: [], steps: USUAL_STEPS, built: true } as const;
const errText = async (res: Response, secrets: (string | undefined)[]) => {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string }; errors?: { message?: string }[] } | null;
  return safeMessage(j?.error?.message ?? j?.errors?.[0]?.message ?? `The service answered ${res.status}.`, secrets);
};

export class GoogleIntegration extends BaseIntegration {
  readonly spec: IntegrationSpec = {
    ...web, id: "google", name: { en: "Google" }, group: "web", icon: "globe", capabilities: ["web.analytics", "maps.geocode"], fallback: "none",
    fields: [
      { key: "measurementId", label: { en: "Analytics measurement id" }, pattern: "G-[A-Z0-9]{4,20}", message: "A Google Analytics id looks like G-ABC123XYZ." },
      { key: "searchConsoleToken", label: { en: "Search Console verification code" }, pattern: "[A-Za-z0-9_-]{10,120}", message: "Paste only the code from the Search Console tag (the part inside content=\"…\")." },
      { key: "mapsKey", label: { en: "Maps key" }, secret: true, maxLength: 200 },
    ],
    guide: [
      { title: "Analytics", body: "In Google Analytics open Admin, Data streams, your website. Copy the measurement id (it starts with G-)." , links: [{ label: "Google Analytics", url: "https://analytics.google.com" }] },
      { title: "Search Console", body: "Add the website as a property, choose the HTML tag method and copy only the code." , links: [{ label: "Search Console", url: "https://search.google.com/search-console" }] },
      { title: "Maps", body: "In Google Cloud create an API key with the Geocoding and Maps JavaScript APIs switched on." , links: [{ label: "Google Cloud credentials", url: "https://console.cloud.google.com/apis/credentials" }] },
    ],
  };
  async test(ctx: IntegrationContext): Promise<TestResult> {
    const c = ctx.config;
    const maps = ctx.secrets.get("mapsKey");
    if (!c.measurementId && !c.searchConsoleToken && !maps) return { ok: false, checks: [check("Details", false, "Save at least one Google value first.")] };
    return probe(async () => {
      const checks = [];
      if (c.measurementId) checks.push(check("Analytics id", true, "Saved. Google gives no way to check it from here; open Analytics → Realtime to see visits."));
      if (c.searchConsoleToken) checks.push(check("Search Console", true, "Saved. In Search Console press Verify once the site shows the tag."));
      if (maps) {
        const res = await ctx.fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Kathmandu&key=${encodeURIComponent(maps)}`);
        const j = (await res.json().catch(() => null)) as { status?: string; error_message?: string } | null;
        checks.push(check("Maps key", j?.status === "OK", j?.status === "OK" ? "Google Maps accepted the key." : safeMessage(j?.error_message ?? `Google answered ${j?.status ?? res.status}.`, [maps])));
      }
      return checks;
    });
  }
}

export class WhatsappIntegration extends BaseIntegration {
  readonly spec: IntegrationSpec = {
    ...web, id: "whatsapp", name: { en: "WhatsApp" }, group: "messaging", icon: "message-circle", capabilities: ["messages.send"], fallback: "platform",
    fields: [
      { key: "phoneId", label: { en: "Phone number id" }, required: true, pattern: "[0-9]{6,30}", message: "The phone number id is digits only (from the WhatsApp page of your Meta app)." },
      { key: "token", label: { en: "Access token" }, required: true, secret: true, maxLength: 600 },
    ],
    guide: [
      { title: "Create the Meta app", body: "In Meta for Developers create a Business app and add the WhatsApp product.", links: [{ label: "Meta for Developers", url: "https://developers.facebook.com/apps" }] },
      { title: "Add the number", body: "Add and confirm the business phone number. Copy its phone number id." },
      { title: "Make a permanent token", body: "Create a system user in Business settings and give it a token with the WhatsApp permissions. Paste it here and press Test." },
    ],
  };
  async test(ctx: IntegrationContext): Promise<TestResult> {
    const token = ctx.secrets.get("token");
    const phoneId = ctx.config.phoneId;
    if (!phoneId || !token) return { ok: false, checks: [check("Details", false, "Save the phone number id and the token first.")] };
    return probe(async () => {
      const res = await ctx.fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return [check("WhatsApp Cloud API", false, await errText(res, [token]))];
      const j = (await res.json().catch(() => null)) as { display_phone_number?: string; verified_name?: string } | null;
      return [check("WhatsApp Cloud API", true, `Connected to ${j?.verified_name ?? "your number"}${j?.display_phone_number ? ` (${j.display_phone_number})` : ""}.`)];
    });
  }
}

export class CloudflareIntegration extends BaseIntegration {
  readonly spec: IntegrationSpec = {
    ...web, id: "cloudflare", name: { en: "Cloudflare" }, group: "web", icon: "shield-check", capabilities: ["dns.manage"], fallback: "none",
    fields: [
      { key: "zoneId", label: { en: "Zone id" }, pattern: "[a-f0-9]{32}", message: "A zone id is 32 letters and digits (Cloudflare → your site → Overview)." },
      { key: "apiToken", label: { en: "API token" }, required: true, secret: true, maxLength: 200 },
    ],
    guide: [
      { title: "Find the zone id", body: "Open your site in Cloudflare. The zone id is on the Overview page, on the right.", links: [{ label: "Cloudflare dashboard", url: "https://dash.cloudflare.com" }] },
      { title: "Create an API token", body: "My Profile, API Tokens, Create Token. Give it Zone DNS Edit for this zone only. Paste it here and press Test." },
    ],
  };
  async test(ctx: IntegrationContext): Promise<TestResult> {
    const token = ctx.secrets.get("apiToken");
    if (!token) return { ok: false, checks: [check("API token", false, "Save the API token first.")] };
    return probe(async () => {
      const headers = { authorization: `Bearer ${token}` };
      const v = await ctx.fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers });
      const checks = [check("API token", v.ok, v.ok ? "Cloudflare accepted the token." : await errText(v, [token]))];
      if (ctx.config.zoneId) {
        const z = await ctx.fetch(`https://api.cloudflare.com/client/v4/zones/${ctx.config.zoneId}`, { headers });
        if (z.ok) { const j = (await z.json().catch(() => null)) as { result?: { name?: string } } | null; checks.push(check("Zone", true, `Found ${j?.result?.name ?? "the zone"}.`)); }
        else checks.push(check("Zone", false, await errText(z, [token])));
      }
      return checks;
    });
  }
}
