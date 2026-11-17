// Adds a business's email DNS records through Cloudflare, so the owner doesn't copy them by hand.
// Where it fits: MailService.autoDns() (Settings → Domain and email → "Add the records for me"). Two ways to reach Cloudflare: Sheetal's own connection
// (Admin → Setup center, for Sheetal's own domain), or a token the business pastes for its own domain, used for that one request and never stored
// (the zone is then found from the domain name). This file only talks to Cloudflare and never sees where a token comes from.
// How it works: planDns() reads what is already at each record's name and says, for every wanted record, "ok" (already right), "add"
// (nothing there) or "replace" (something else is there, for example the old provider's MX and SPF). applyDns() does the adds always and the
// replaces only when the caller said so, because replacing an MX stops mail at the old provider. Replacing never touches records of other kinds.
// Rules: only the exact domain of the connected zone; one SPF record per domain (the old one is changed, not duplicated); the token is never
// logged or returned; every Cloudflare error is turned into a plain sentence.

import type { DnsRecord } from "./mail-dns.js";

/** The token, and the zone when it is known (the platform's own connection). With a token only, the zone is found from the domain name. */
export interface CloudflareAccess { token: string; zoneId?: string }
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ZoneRecord { id: string; type: string; name: string; content: string; priority?: number; ttl?: number; proxied?: boolean }
export type DnsAction = "ok" | "add" | "replace";
export interface PlanItem {
  id: DnsRecord["id"]; type: "TXT" | "MX"; host: string; value: string; priority?: number; action: DnsAction;
  /** What is there now at this name (for "replace": what will be removed or changed). */
  current: string[];
  /** Zone record ids to change or remove when replacing. */
  replaceIds: string[];
  /** MX only: the right record already exists next to the others, so replacing only removes the others. */
  keep?: boolean;
  note: string;
}
export interface DnsPlan { zone: string; items: PlanItem[]; needsConfirm: boolean }
export interface ApplyResult { id: DnsRecord["id"]; host: string; done: "added" | "replaced" | "already right" | "skipped"; note: string }

const BASE = "https://api.cloudflare.com/client/v4";
const unquote = (s: string) => s.replace(/^"([\s\S]*)"$/, "$1").replace(/"\s+"/g, "");
const host = (s: string) => s.replace(/\.$/, "").toLowerCase();

export class CloudflareError extends Error {}

export function cloudflareApi(access: CloudflareAccess, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  const call = async (method: string, path: string, body?: object): Promise<{ result: unknown }> => {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchFn(`${BASE}${path}`, {
        method, headers: { authorization: `Bearer ${access.token}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CloudflareError("Couldn't reach Cloudflare. Try again in a minute.");
    }
    const json = (await res.json().catch(() => null)) as { success?: boolean; result?: unknown; errors?: { message?: string }[] } | null;
    if (!res.ok || !json || json.success === false) {
      const why = json?.errors?.map((e) => e.message).filter(Boolean).join("; ");
      throw new CloudflareError(res.status === 401 || res.status === 403
        ? "Cloudflare refused the saved token. In Admin → Setup center → Cloudflare, create a token with Zone → DNS → Edit for this site, save it and test it."
        : `Cloudflare said: ${why || `error ${res.status}`}`);
    }
    return { result: json.result };
  };
  let zoneId = access.zoneId;
  const zonePath = () => { if (!zoneId) throw new CloudflareError("Cloudflare site not chosen yet."); return `/zones/${zoneId}`; };
  return {
    /** The name of the zone that will be changed. With a known zone id it reads that zone; with a token only, it finds the zone whose name is `domain`. */
    async zoneFor(domain: string): Promise<string> {
      if (zoneId) { const r = (await call("GET", zonePath())).result as { name?: string }; return String(r?.name ?? "").toLowerCase(); }
      const found = (((await call("GET", `/zones?name=${encodeURIComponent(domain)}&per_page=5`)).result ?? []) as { id: string; name: string }[]).find((z) => String(z.name).toLowerCase() === domain);
      if (!found) throw new CloudflareError(`This token can't see ${domain}. In Cloudflare, make the token for the site ${domain} (Zone, DNS, Edit; also Zone, Zone, Read) and try again.`);
      zoneId = found.id;
      return domain;
    },
    async list(name: string): Promise<ZoneRecord[]> { return ((await call("GET", `${zonePath()}/dns_records?per_page=100&name=${encodeURIComponent(name)}`)).result ?? []) as ZoneRecord[]; },
    async add(r: { type: string; name: string; content: string; priority?: number }) { await call("POST", `${zonePath()}/dns_records`, { ...r, ttl: 1 }); },
    async update(id: string, r: { type: string; name: string; content: string; priority?: number }) { await call("PUT", `${zonePath()}/dns_records/${id}`, { ...r, ttl: 1 }); },
    async remove(id: string) { await call("DELETE", `${zonePath()}/dns_records/${id}`); },
  };
}
export type CloudflareApi = ReturnType<typeof cloudflareApi>;

const FAMILY: Record<string, (v: string) => boolean> = {
  verify: (v) => v.startsWith("sheetal-verify="),
  spf: (v) => v.toLowerCase().startsWith("v=spf1"),
  dkim: (v) => v.startsWith("v=DKIM1"),
  dmarc: (v) => v.startsWith("v=DMARC1"),
};

/** Reads what is at each wanted record's name and decides ok / add / replace. Changes nothing. */
export async function planDns(api: Pick<CloudflareApi, "list">, zone: string, wanted: DnsRecord[], mailHost: string): Promise<DnsPlan> {
  const items: PlanItem[] = [];
  for (const w of wanted) {
    const there = await api.list(w.host);
    const base = { id: w.id, type: w.type, host: w.host, value: w.value, priority: w.priority };
    if (w.type === "MX") {
      const mx = there.filter((r) => r.type === "MX");
      const right = mx.filter((r) => host(r.content) === host(mailHost) && (r.priority ?? 10) === (w.priority ?? 10));
      const others = mx.filter((r) => !right.includes(r));
      if (right.length && !others.length) items.push({ ...base, action: "ok", current: [], replaceIds: [], note: "Already points to the Sheetal mail server." });
      else if (!mx.length) items.push({ ...base, action: "add", current: [], replaceIds: [], note: "Mail for this domain will go to the Sheetal mail server." });
      else items.push({ ...base, action: "replace", keep: right.length > 0, current: others.map((r) => `${r.priority ?? ""} ${host(r.content)}`.trim()), replaceIds: others.map((r) => r.id), note: "Other mail servers are set for this domain. Replacing them moves ALL mail to Sheetal. Mail at the old provider stops arriving." });
      continue;
    }
    const txts = there.filter((r) => r.type === "TXT").map((r) => ({ ...r, content: unquote(r.content) }));
    const same = txts.find((r) => r.content === w.value);
    const family = FAMILY[w.id];
    const clash = family ? txts.filter((r) => family(r.content) && r.content !== w.value) : [];
    if (same && !clash.length) items.push({ ...base, action: "ok", current: [], replaceIds: [], note: "Already there." });
    else if (clash.length) items.push({ ...base, action: "replace", current: clash.map((r) => r.content.slice(0, 120)), replaceIds: clash.map((r) => r.id), note: w.id === "spf" ? "A different sending rule (SPF) exists. A domain may have only one, so it is changed to include Sheetal." : "A different value is there; it is changed." });
    else items.push({ ...base, action: "add", current: [], replaceIds: [], note: "Will be added." });
  }
  return { zone, items, needsConfirm: items.some((i) => i.action === "replace") };
}

/** Does the plan. Adds always; replaces only when `replace` is true. Never touches a record that is not in the plan. */
export async function applyDns(api: Pick<CloudflareApi, "add" | "update" | "remove">, plan: DnsPlan, replace: boolean): Promise<ApplyResult[]> {
  const out: ApplyResult[] = [];
  for (const i of plan.items) {
    const rec = { type: i.type, name: i.host, content: i.value, ...(i.priority != null ? { priority: i.priority } : {}) };
    if (i.action === "ok") { out.push({ id: i.id, host: i.host, done: "already right", note: i.note }); continue; }
    if (i.action === "add") { await api.add(rec); out.push({ id: i.id, host: i.host, done: "added", note: "Added." }); continue; }
    if (!replace) { out.push({ id: i.id, host: i.host, done: "skipped", note: "Needs your OK to replace what is there now." }); continue; }
    if (i.type === "MX") {
      for (const id of i.replaceIds) await api.remove(id);
      if (!i.keep) await api.add(rec);
    } else {
      const [first, ...rest] = i.replaceIds;
      if (first) await api.update(first, rec); else await api.add(rec);
      for (const id of rest) await api.remove(id);
    }
    out.push({ id: i.id, host: i.host, done: "replaced", note: "Replaced." });
  }
  return out;
}
