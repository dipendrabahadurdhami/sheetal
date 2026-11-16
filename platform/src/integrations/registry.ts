// The list of every outside service Sheetal knows about (INTEGRATIONS.md section 13): ten with their provider code, the rest as shells.
// Where it fits: service.ts looks an integration up here; the admin Integration Center lists them all. A new provider = one file in providers/ and one line here.
// How it works: a shell has its spec (name, fields, steps, guide) but no provider code, so its details can be saved now and it is switched on later with
// no new screen and no code change on the screens (the team rule "credentials arriving later never need a code change").
// Rules: ids are stable (they are stored). Lower-case, dots allowed. Never remove an id that may have a connection; mark it with a note instead.

import type { Integration, IntegrationScope, IntegrationSpec } from "./types.js";
import { shell } from "./providers/base.js";
import { EsewaIntegration, FonepayIntegration, KhaltiIntegration } from "./providers/payments.js";
import { CloudflareIntegration, GoogleIntegration, WhatsappIntegration } from "./providers/web.js";
import { AnthropicIntegration, ElevenLabsIntegration, GeminiIntegration, OpenAiIntegration } from "./providers/ai.js";

const key = (label: string, k = "apiKey") => ({ key: k, label: { en: label }, required: true, secret: true, maxLength: 400 } as const);
const text = (k: string, label: string, required = false) => ({ key: k, label: { en: label }, required, maxLength: 200 } as const);
const BOTH = ["platform", "business"] as const;
const delivery = (id: string, name: string) => shell({ id, name: { en: name }, group: "delivery", icon: "bus", scopes: ["business"], modes: ["test", "live"], fields: [text("merchantId", "Merchant id", true), key("API secret", "apiSecret")], capabilities: ["delivery.order"] });
const ota = (id: string, name: string) => shell({ id, name: { en: name }, group: "channels", icon: "calendar-days", scopes: ["business"], modes: ["live"], fields: [{ key: "icalUrl", label: { en: "Calendar (iCal) link" }, pattern: "https://\\S{8,400}", message: "Paste the full calendar link, starting with https://", maxLength: 420 }], capabilities: ["channels.calendar"] });

export const INTEGRATIONS: readonly Integration[] = [
  new EsewaIntegration(), new KhaltiIntegration(), new FonepayIntegration(),
  shell({ id: "fonepay_qr", name: { en: "Fonepay dynamic QR" }, group: "payments", icon: "qr-code", scopes: BOTH, modes: ["test", "live"], fields: [text("merchantCode", "Merchant code", true), key("Secret key", "secretKey"), text("username", "QR API user"), key("QR API password", "password")], capabilities: ["payments.qr"] }),
  shell({ id: "card", name: { en: "Bank card gateway" }, group: "payments", icon: "credit-card", scopes: BOTH, modes: ["test", "live"], fields: [text("bank", "Bank"), text("merchantId", "Merchant id", true), key("Secret key", "secretKey")], capabilities: ["payments.checkout"], note: { en: "Waiting for the bank agreement." } }),
  new WhatsappIntegration(),
  shell({ id: "sms", name: { en: "SMS" }, group: "messaging", icon: "message-square", scopes: ["platform"], modes: ["live"], fields: [text("provider", "Provider"), key("Token", "token"), text("sender", "Sender name")], capabilities: ["messages.send"], note: { en: "Not used for now: WhatsApp sends instead." } }),
  shell({ id: "email", name: { en: "Email" }, group: "email", icon: "mail", scopes: ["platform"], modes: ["live"], fields: [text("accountId", "Cloudflare account id"), key("API token", "apiToken"), text("domain", "Domain")], requires: ["cloudflare"], capabilities: ["email.send"] }),
  new CloudflareIntegration(), new GoogleIntegration(),
  // Built in P3-BE-8 (providers/ai.ts): same ids and fields as the shells they replace.
  new AnthropicIntegration(), new OpenAiIntegration(), new GeminiIntegration(), new ElevenLabsIntegration(),
  shell({ id: "meta", name: { en: "Facebook and Instagram" }, group: "social", icon: "megaphone", scopes: BOTH, modes: ["live"], fields: [text("appId", "App id", true), key("App secret", "appSecret"), text("pageId", "Page id"), key("Page token", "pageToken")], capabilities: ["messages.send", "social.post"] }),
  delivery("delivery.pathao", "Pathao"), delivery("delivery.foodmandu", "Foodmandu"), delivery("delivery.yango", "Yango"),
  ota("ota.booking", "Booking.com"), ota("ota.airbnb", "Airbnb"), ota("ota.agoda", "Agoda"), ota("ota.expedia", "Expedia"),
  shell({ id: "tax.cbms", name: { en: "IRD billing (CBMS)" }, group: "tax", icon: "landmark", scopes: ["business"], modes: ["test", "live"], fields: [text("username", "CBMS user", true), key("Password", "password")], capabilities: ["tax.submit_invoice"] }),
];

const BY_ID = new Map(INTEGRATIONS.map((i) => [i.id, i]));

export const integrationOf = (id: string): Integration | null => BY_ID.get(id) ?? null;
export const specsFor = (scope: IntegrationScope): IntegrationSpec[] => INTEGRATIONS.map((i) => i.describe()).filter((s) => s.scopes.includes(scope));
/** Problems in the list itself (a test runs it): duplicate ids, a secret field with no mode, an unknown `requires`. */
export function registryProblems(list: readonly Integration[] = INTEGRATIONS): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const i of list) {
    const s = i.describe();
    if (!/^[a-z][a-z0-9_.]*$/.test(s.id)) out.push(`${s.id}: bad id`);
    if (ids.has(s.id)) out.push(`${s.id}: listed twice`);
    ids.add(s.id);
    if (!s.modes.length || !s.scopes.length) out.push(`${s.id}: needs a mode and a scope`);
    const keys = new Set<string>();
    for (const f of s.fields) { if (keys.has(f.key)) out.push(`${s.id}: field ${f.key} twice`); keys.add(f.key); }
  }
  for (const i of list) for (const r of i.describe().requires ?? []) if (!ids.has(r)) out.push(`${i.id}: requires unknown ${r}`);
  return out;
}
