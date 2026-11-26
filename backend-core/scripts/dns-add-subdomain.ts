// dns-add-subdomain: adds one name under Sheetal's own domain (e.g. technology.sheetalproperty.com) through the Setup-center Cloudflare
// connection, pointing where www points (same address, same Cloudflare proxy setting). Nothing else in the zone is touched.
// Run on the server from /srv/sheetal/backend-core:
//     npx tsx scripts/dns-add-subdomain.ts --name=technology            (dry run: shows what it would add)
//     npx tsx scripts/dns-add-subdomain.ts --name=technology --apply    (adds it)
// Safe to run again: an existing record of that name is left as it is.
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { Vault } from "@sheetal/platform/auth/vault";
import { IntegrationService, PLATFORM } from "@sheetal/platform/integrations/service";

const args = process.argv.slice(2);
const value = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const apply = args.includes("--apply");
const quiet = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return quiet; }, level: "silent" } as never;

loadEnvFiles();
const cfg = loadConfig(process.env, "business");
const db = new PrismaClient({ datasources: { db: { url: cfg.DATABASE_URL } } });

type Rec = { id: string; type: string; name: string; content: string; proxied: boolean; ttl: number };

async function main(): Promise<number> {
  const sub = value("name");
  if (!sub || !/^[a-z][a-z0-9-]{1,30}$/.test(sub)) { console.error("Say the name: --name=technology"); return 1; }
  const svc = new IntegrationService({ db: db as never, vault: new Vault(cfg.SECRETS_KEY, cfg.NODE_ENV === "production"), env: cfg.NODE_ENV === "production" ? "production" : "development", log: quiet });
  const r = await svc.resolve(PLATFORM, "cloudflare").catch(() => null);
  const token = r?.secrets.get("apiToken"), zoneId = r?.config.zoneId as string | undefined;
  if (!token || !zoneId) { console.error("The Setup-center Cloudflare connection isn't live (token or zone id missing)."); return 1; }
  const call = async (method: string, path: string, body?: object) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json() as { success: boolean; result: unknown; errors?: { message: string }[] };
    if (!j.success) throw new Error(`Cloudflare said: ${j.errors?.map((e) => e.message).join("; ") || res.status}`);
    return j.result;
  };
  const zone = await call("GET", "") as { name: string };
  const host = `${sub}.${zone.name}`;
  const www = (await call("GET", `/dns_records?name=www.${zone.name}`) as Rec[]).find((x) => x.type === "A" || x.type === "CNAME");
  if (!www) { console.error(`www.${zone.name} has no A or CNAME record to copy.`); return 1; }
  const have = await call("GET", `/dns_records?name=${host}`) as Rec[];
  console.log(apply ? "APPLYING" : "DRY RUN (nothing is written; add --apply to write)");
  console.log(`zone ${zone.name}; www is ${www.type} ${www.content} (proxied ${www.proxied})`);
  if (have.length) { console.log(`${host} already exists: ${have.map((x) => `${x.type} ${x.content} proxied ${x.proxied}`).join(", ")}. Nothing to do. PASS`); return 0; }
  const rec = { type: www.type, name: host, content: www.content, proxied: www.proxied, ttl: 1 };
  console.log(`would add: ${rec.type} ${rec.name} -> ${rec.content} (proxied ${rec.proxied})`);
  if (apply) {
    await call("POST", "/dns_records", rec);
    console.log(`added ${host}. PASS`);
  } else console.log("PASS (dry run)");
  return 0;
}

main()
  .then((c) => { process.exitCode = c; })
  .catch((e) => { console.error(e instanceof Error ? e.message : e); console.log("FAIL"); process.exitCode = 1; })
  .finally(() => db.$disconnect());
