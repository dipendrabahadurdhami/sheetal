// DNS records a business adds at its domain provider for email, and the check that reads them back.
// Where it fits: Settings → Domain and email (apps/workspace/backend/mail.service.ts; moved here from business/backend/src/modules/mail/dns.ts in P2-W6).
// How it works: lists the MX, SPF, DKIM, DMARC and verification records for the domain, and checks each one is
// published. The DNS resolver can be swapped in tests.

import { generateKeyPairSync } from "node:crypto";
import { promises as nodeDns } from "node:dns";

export interface Resolver {
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
  resolveTxt(name: string): Promise<string[][]>;
}
export const systemResolver: Resolver = { resolveMx: (n) => nodeDns.resolveMx(n), resolveTxt: (n) => nodeDns.resolveTxt(n) };

export interface DomainKeys { verifyToken: string; dkimSelector: string; dkimPublicKey: string }
export interface DnsRecord { id: "verify" | "mx" | "spf" | "dkim" | "dmarc"; type: "TXT" | "MX"; host: string; value: string; priority?: number; required: boolean; purpose: string }

/** A new signing key pair for a domain: the public half goes in DNS, the private half signs outgoing mail. */
export function newDkimKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey: Buffer.from(publicKey).toString("base64"), privateKey: String(privateKey) };
}

export function recordsFor(domain: string, keys: DomainKeys, mailHost: string): DnsRecord[] {
  return [
    { id: "verify", type: "TXT", host: `_sheetal-verify.${domain}`, value: `sheetal-verify=${keys.verifyToken}`, required: true, purpose: "Proves you own the domain" },
    { id: "mx", type: "MX", host: domain, value: mailHost, priority: 10, required: true, purpose: "Delivers mail for your domain to Sheetal" },
    { id: "spf", type: "TXT", host: domain, value: `v=spf1 a:${mailHost} ~all`, required: true, purpose: "Lets Sheetal send mail as your domain" },
    { id: "dkim", type: "TXT", host: `${keys.dkimSelector}._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=${keys.dkimPublicKey}`, required: true, purpose: "Signs your mail so it isn't marked as spam" },
    { id: "dmarc", type: "TXT", host: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}`, required: false, purpose: "Tells other servers what to do with fake mail (recommended)" },
  ];
}

const txt = async (r: Resolver, host: string) => (await r.resolveTxt(host).catch(() => [] as string[][])).map((parts) => parts.join(""));

/** Reads each record back: "ok", "missing" (nothing there) or "wrong" (something else is there). */
export async function checkRecords(r: Resolver, domain: string, keys: DomainKeys, mailHost: string): Promise<Record<string, "ok" | "missing" | "wrong">> {
  const out: Record<string, "ok" | "missing" | "wrong"> = {};
  for (const rec of recordsFor(domain, keys, mailHost)) {
    if (rec.type === "MX") {
      const mx = await r.resolveMx(rec.host).catch(() => []);
      out[rec.id] = !mx.length ? "missing" : mx.some((m) => m.exchange.replace(/\.$/, "").toLowerCase() === mailHost.toLowerCase()) ? "ok" : "wrong";
      continue;
    }
    const values = await txt(r, rec.host);
    const ok =
      rec.id === "verify" ? values.includes(rec.value)
      : rec.id === "spf" ? values.some((v) => v.startsWith("v=spf1") && v.includes(mailHost))
      : rec.id === "dkim" ? values.some((v) => v.replace(/\s/g, "").includes(`p=${keys.dkimPublicKey}`))
      : values.some((v) => v.startsWith("v=DMARC1"));
    const relevant = rec.id === "spf" ? values.filter((v) => v.startsWith("v=spf1")) : rec.id === "dmarc" ? values.filter((v) => v.startsWith("v=DMARC1")) : values;
    out[rec.id] = ok ? "ok" : relevant.length ? "wrong" : "missing";
  }
  return out;
}

export const isVerified = (checks: Record<string, string>) => ["verify", "mx", "spf", "dkim"].every((k) => checks[k] === "ok");
