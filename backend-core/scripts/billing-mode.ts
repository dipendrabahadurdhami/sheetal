// billing-mode: shows and changes the billing mode of businesses (MARKETPLACE-AND-BILLING.md section 8.6; P3-OPS-1).
//   plans  = today's Starter / Business / Pro (every business until the cutover)
//   shadow = the plan still answers; the app subscriptions are worked out beside it and every difference is recorded
//   apps   = the app subscriptions answer; the marketplace is open for that business
// Where it fits: after `npm run billing:migrate -- --apply` wrote the app rows (nobody sees a change yet), this moves businesses forward:
// all to shadow, 7 days later the pilot to apps, then everyone. The owner's cutover scripts (scripts/ops/RUN-P3-CUTOVER-*.cmd) call it.
// The rules are in src/domain/billing-mode.ts. From the repo root:
//     npm run billing:mode                                        (the list: every business, its mode and what stands in its way)
//     npm run billing:mode -- --to=shadow --all                   (says what would change; writes nothing)
//     npm run billing:mode -- --to=shadow --all --apply           (writes; one transaction per business)
//     npm run billing:mode -- --to=apps --business=ID[,ID] --min-days=0 --apply     (the pilot: before the 7 days are over)
//     npm run billing:mode -- --to=apps --all --apply             (everyone: 7 days on shadow with no "less" difference)
//     npm run billing:mode -- --to=plans --business=ID --apply    (go back; refused once the business bought something on the new system)
//     add --force to skip the shadow rules (never the payment-in-flight rule, never the go-back rule)
// Moving to apps voids the business's open plan and add-on invoices (the renewal job makes the new ones). Take a backup first.
// DATABASE_URL comes from the shell, else backend-core/.env. Business names are masked to 2 letters plus the id. It ends with PASS or
// FAIL (exit code 0 or 1); FAIL = at least one business was refused. Run it with the API servers stopped, then start them again.
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import type { BillingMode } from "@sheetal/platform/billing/load";
import { MODES, modeStatus, setMode } from "../src/domain/billing-mode.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

loadEnvFiles();
const db = new PrismaClient({ datasources: { db: { url: loadConfig(process.env, "website").DATABASE_URL } } });
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

async function main(): Promise<number> {
  const to = value("to");
  const only = value("business")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!to) {
    const rows = await modeStatus(db as never, { only });
    for (const r of rows) {
      const notes = [
        r.migrated ? null : "no app rows",
        r.shadowSince ? `shadow since ${day(r.shadowSince)}, ${r.reports} report(s), ${r.lessReports} with less` : null,
        r.lessNow.length ? `LESS today: ${r.lessNow.join("; ")}` : null,
        r.openInvoices.length ? `${r.openInvoices.length} open plan invoice(s)` : null,
        r.paymentsInFlight ? `${r.paymentsInFlight} payment(s) in flight` : null,
        r.sold ? "has a sale on the new system" : null,
      ].filter(Boolean).join("; ");
      console.log(`${r.mode.padEnd(6)} ${r.masked} [${r.status}]${notes ? `: ${notes}` : ""}`);
    }
    const n = (m: string) => rows.filter((r) => r.mode === m).length;
    const less = rows.filter((r) => r.lessNow.length || r.lessReports).length;
    console.log(`${rows.length} businesses: ${n("plans")} on plans, ${n("shadow")} on shadow, ${n("apps")} on apps; ${rows.filter((r) => r.migrated).length} have app rows; ${less} with a "less" difference. ${less ? "FAIL" : "PASS"}`);
    return less ? 1 : 0;
  }
  if (!(MODES as readonly string[]).includes(to)) { console.error(`--to must be one of: ${MODES.join(", ")}`); return 1; }
  if (!flag("all") && !only?.length) { console.error("Say which businesses: --business=ID[,ID] or --all"); return 1; }
  const minDays = value("min-days");
  if (minDays !== undefined && !/^\d+$/.test(minDays)) { console.error("--min-days must be a whole number"); return 1; }
  const apply = flag("apply");
  const res = await setMode(db as never, { to: to as BillingMode, only, all: flag("all"), apply, force: flag("force"), minShadowDays: minDays === undefined ? undefined : Number(minDays) });
  console.log(apply ? `MODE CHANGE to ${to}` : `DRY RUN to ${to} (nothing is written; add --apply to write)`);
  for (const r of res) {
    const word = !r.ok ? "REFUSED" : r.reason ? "SAME   " : apply ? "MOVED  " : "WOULD  ";
    console.log(`${word} ${r.masked}: ${r.from} -> ${r.to}${r.reason ? ` (${r.reason})` : ""}${r.voided.length ? `; open plan invoices ${apply ? "voided" : "to void"}: ${r.voided.join(", ")}` : ""}`);
  }
  const refused = res.filter((r) => !r.ok).length, moved = res.filter((r) => r.ok && !r.reason).length;
  console.log(`${res.length} businesses: ${moved} ${apply ? "moved" : "would move"}, ${res.length - moved - refused} already there, ${refused} refused. ${refused ? "FAIL" : "PASS"}`);
  return refused ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
