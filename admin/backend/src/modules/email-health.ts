// Super Admin → Email: is Sheetal's own mail domain connected, is the mail server up, what happened to the latest system emails (password resets, invites...).
// Where it fits: the admin panel's Email page (admin/frontend/src/pages/AdminEmail.jsx). The list of system emails and "send again" stay in insight.ts.
// How it works: GET /admin/email/overview reads the DNS of Sheetal's own domain live (ownership proof, MX, SPF, DKIM, DMARC, the mail host's address and its
// reverse DNS), asks the local mail port if it answers, and counts what waits, failed or arrived; POST /admin/email/domains/:id/check re-checks any business's
// domain the way the business's own "Check records" does and saves the result; POST /admin/email/test queues a test email so staff can see delivery work.
// Rules: staff with settings access only; nothing secret is returned (no keys, no email text); every check and test is audited; DNS and the mail port can be
// swapped in tests.

import type { FastifyInstance } from "fastify";
import { promises as nodeDns } from "node:dns";
import net from "node:net";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { notFound } from "@sheetal/platform/core/errors";
import { staffOf } from "./routes.js";

export interface EmailDns {
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
  resolveTxt(name: string): Promise<string[][]>;
  resolve4(name: string): Promise<string[]>;
  reverse(ip: string): Promise<string[]>;
}
export const systemEmailDns: EmailDns = {
  resolveMx: (n) => nodeDns.resolveMx(n), resolveTxt: (n) => nodeDns.resolveTxt(n), resolve4: (n) => nodeDns.resolve4(n), reverse: (ip) => nodeDns.reverse(ip),
};
/** Does the mail port on this computer answer with a "220" greeting? null = could not tell. */
export type SmtpProbe = () => Promise<boolean | null>;
export const localSmtpProbe = (port: number): SmtpProbe => () => new Promise((resolve) => {
  const s = net.createConnection({ host: "127.0.0.1", port });
  const done = (v: boolean | null) => { s.destroy(); resolve(v); };
  s.setTimeout(3000, () => done(false));
  s.once("error", () => done(false));
  s.once("data", (b) => done(String(b).startsWith("220")));
});

export type CheckStatus = "ok" | "missing" | "wrong";
export interface EmailCheck { id: string; label: string; status: CheckStatus; detail: string; fix: string; optional?: boolean }

const PERM = "platform.settings.read+platform.settings.update";
const bare = (h: string) => h.replace(/\.$/, "").toLowerCase();
/** The domain of the site, without "www.": Sheetal's own email domain. */
export const platformDomainOf = (siteUrl: string) => { try { return new URL(siteUrl).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

interface DomainKeys { name: string; verifyToken: string; dkimSelector: string; dkimPublicKey: string }

/** The five records a domain needs, read back from live DNS. Same meaning as the business's own "Check records". */
export async function domainChecks(d: DomainKeys, mailHost: string, dns: EmailDns): Promise<EmailCheck[]> {
  const txt = async (host: string) => (await dns.resolveTxt(host).catch(() => [] as string[][])).map((p) => p.join(""));
  const list = (v: string[]) => (v.length ? v.map((x) => (x.length > 70 ? `${x.slice(0, 70)}…` : x)).join(" | ") : "nothing found");
  const out: EmailCheck[] = [];

  const verify = await txt(`_sheetal-verify.${d.name}`);
  out.push({ id: "verify", label: "Ownership proof", status: verify.includes(`sheetal-verify=${d.verifyToken}`) ? "ok" : verify.length ? "wrong" : "missing", detail: list(verify),
    fix: `Add a TXT record named _sheetal-verify.${d.name} with the value shown on the business's Domain and email page.` });

  const mx = await dns.resolveMx(d.name).catch(() => [] as { exchange: string; priority: number }[]);
  out.push({ id: "mx", label: "Mail goes to Sheetal (MX)", status: mx.some((m) => bare(m.exchange) === mailHost.toLowerCase()) ? "ok" : mx.length ? "wrong" : "missing",
    detail: mx.length ? mx.map((m) => `${m.priority} ${bare(m.exchange)}`).join(" | ") : "nothing found",
    fix: `Set one MX record for ${d.name}: priority 10, mail server ${mailHost}. Remove other MX records, or mail goes elsewhere.` });

  const spf = (await txt(d.name)).filter((v) => v.toLowerCase().startsWith("v=spf1"));
  out.push({ id: "spf", label: "Sending rule (SPF)", status: spf.some((v) => v.includes(mailHost)) ? "ok" : spf.length ? "wrong" : "missing", detail: list(spf),
    fix: `A domain may have only one SPF record. Make it: v=spf1 a:${mailHost} ~all` });

  const dkim = await txt(`${d.dkimSelector}._domainkey.${d.name}`);
  out.push({ id: "dkim", label: "Mail signature (DKIM)", status: dkim.some((v) => v.replace(/\s/g, "").includes(`p=${d.dkimPublicKey}`)) ? "ok" : dkim.length ? "wrong" : "missing", detail: list(dkim),
    fix: `Add the TXT record named ${d.dkimSelector}._domainkey.${d.name} shown on the business's Domain and email page.` });

  const dmarc = (await txt(`_dmarc.${d.name}`)).filter((v) => v.startsWith("v=DMARC1"));
  out.push({ id: "dmarc", label: "Fake-mail policy (DMARC)", status: dmarc.length ? "ok" : "missing", detail: list(dmarc), optional: true,
    fix: `Recommended: add a TXT record named _dmarc.${d.name}: v=DMARC1; p=quarantine; rua=mailto:postmaster@${d.name}` });
  return out;
}

/** The mail host itself: it must have an address, and that address must point back to the same name (reverse DNS), or Gmail and Outlook distrust the mail. */
export async function hostChecks(mailHost: string, dns: EmailDns): Promise<EmailCheck[]> {
  const ips = await dns.resolve4(mailHost).catch(() => [] as string[]);
  const out: EmailCheck[] = [{ id: "host", label: `${mailHost} has an address`, status: ips.length ? "ok" : "missing", detail: ips.length ? ips.join(", ") : "nothing found",
    fix: `Add an A record named ${mailHost} that points to the server's public IP (DNS only, not proxied).` }];
  const names = ips.length ? await dns.reverse(ips[0]!).catch(() => [] as string[]) : [];
  out.push({ id: "ptr", label: "Reverse DNS (PTR)", status: !ips.length ? "missing" : names.some((n) => bare(n) === mailHost.toLowerCase()) ? "ok" : names.length ? "wrong" : "missing",
    detail: !ips.length ? "needs the address above first" : names.length ? names.map(bare).join(" | ") : "nothing set",
    fix: `Ask your hosting company (DataHub support) to set the reverse DNS of ${ips[0] ?? "the server's IP"} to ${mailHost}.` });
  return out;
}

export interface EmailHealthOptions { dns?: EmailDns; smtp?: SmtpProbe }

export async function adminEmailRoutes(app: FastifyInstance, opts: EmailHealthOptions = {}) {
  const db = () => dbOf(app);
  const dns = opts.dns ?? systemEmailDns;
  const smtp = opts.smtp ?? localSmtpProbe(Number(process.env.SMTP_PORT) || 25);
  const mailHost = () => app.config.MAIL_HOST;
  const audit = (actorId: string, ip: string, action: string, target: string) => db().auditLog.create({ data: { actorId, action, target, ip } });

  app.get("/admin/email/overview", async (request) => {
    staffOf(request, PERM);
    const own = platformDomainOf(app.config.SITE_URL);
    const day = new Date(Date.now() - 864e5);
    const [domains, boxes, lastSent, lastIn, waiting, failed, pendingDeliveries, failedDeliveries, recent, listening] = await Promise.all([
      db().mailDomain.findMany({ orderBy: { name: "asc" } }),
      db().mailbox.groupBy({ by: ["domainId"], _count: true }),
      db().outboundEmail.findFirst({ where: { status: "sent" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
      db().mailMessage.findFirst({ where: { folder: "inbox", status: "received" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db().outboundEmail.count({ where: { status: { in: ["queued", "deferred", "sending"] } } }),
      db().outboundEmail.count({ where: { status: "failed", createdAt: { gte: day } } }),
      db().mailDelivery.count({ where: { status: { in: ["queued", "retry"] } } }),
      db().mailDelivery.count({ where: { status: "failed", createdAt: { gte: day } } }),
      db().outboundEmail.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, to: true, subject: true, status: true, attempts: true, error: true, createdAt: true, sentAt: true } }),
      smtp().catch(() => null),
    ]);
    const tenants = new Map((await db().tenant.findMany({ where: { id: { in: [...new Set(domains.map((d) => d.tenantId))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    const boxCount = new Map(boxes.map((b) => [b.domainId, b._count]));
    const ownRow = domains.find((d) => d.name === own) ?? null;
    const checks = [...(ownRow ? await domainChecks(ownRow, mailHost(), dns) : []), ...(await hostChecks(mailHost(), dns))];
    const problems = checks.filter((c) => c.status !== "ok" && !c.optional).length;
    const connected = !!ownRow?.verified && !checks.some((c) => ["verify", "mx", "spf", "dkim"].includes(c.id) && c.status !== "ok");
    return {
      data: {
        platformDomain: own, mailHost: mailHost(), domainAdded: !!ownRow, connected, problems,
        healthy: connected && problems === 0 && listening !== false && failed === 0,
        checks,
        server: { listening, lastSentAt: lastSent?.sentAt ?? null, lastReceivedAt: lastIn?.createdAt ?? null, waitingToSend: waiting, failedLast24h: failed,
          deliveriesWaiting: pendingDeliveries, deliveriesFailedLast24h: failedDeliveries, mailboxes: boxes.reduce((n, b) => n + b._count, 0) },
        domains: domains.map((d) => ({ id: d.id, name: d.name, business: tenants.get(d.tenantId) ?? "", verified: d.verified, checkedAt: d.checkedAt, checks: d.checks, mailboxes: boxCount.get(d.id) ?? 0, isPlatform: d.name === own })),
        recent,
      },
    };
  });

  app.post<{ Params: { id: string } }>("/admin/email/domains/:id/check", async (request) => {
    const s = staffOf(request, PERM);
    const d = await db().mailDomain.findUnique({ where: { id: request.params.id } });
    if (!d) throw notFound("Domain not found.");
    const checks = await domainChecks(d, mailHost(), dns);
    const map = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    const verified = ["verify", "mx", "spf", "dkim"].every((k) => map[k] === "ok");
    await db().mailDomain.update({ where: { id: d.id }, data: { checks: map, verified, checkedAt: new Date() } });
    await audit(s.user.id, request.ip, "email.domain_checked", d.name);
    return { message: verified ? `${d.name}: all records found.` : `${d.name}: some records are missing or different.`, data: { verified, checks } };
  });

  app.post("/admin/email/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const s = staffOf(request, PERM);
    const b = z.object({ to: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")) }).parse(request.body);
    const row = await db().outboundEmail.create({ data: { to: b.to, subject: "Sheetal email test", text: "This is a test email from the Sheetal Super Admin. If you can read it, sending works. You can delete it." } });
    await audit(s.user.id, request.ip, "email.test_sent", b.to);
    return { message: "Test email queued. The mail server sends it within a minute; watch the list below.", data: { id: row.id } };
  });
}
