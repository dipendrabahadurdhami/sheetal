// `npm run payouts:sample`: adds sample collected payments to one business so Billing → Payouts (admin) and
// Business → Payouts can be tested. Safe to run again: the same samples are never added twice.
// Usage: npm run payouts:sample -- [--tenant <id or name>] [--add-bank] [--help]
//   --tenant   the business (default: the first one that has a bank account for payouts)
//   --add-bank give the business a sample bank account if it has none (only for testing)
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "../src/config.js";
import { bankOf, nepalDay, recordCollected, type Collected } from "../src/domain/payouts.js";
import { dayOf, ymd } from "../src/domain/money.js";

if (process.argv.includes("--help")) {
  console.log("npm run payouts:sample -- [--tenant <id or name>] [--add-bank]\nAdds sample collected payments (old ones ready to pay out, recent ones on hold, one refund).");
  process.exit(0);
}

loadEnvFiles();
const config = loadConfig(process.env, "website");

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
const db = prisma;

try {
  const want = arg("--tenant");
  const all = await prisma.tenant.findMany({ select: { id: true, name: true, settings: true }, orderBy: { createdAt: "asc" } });
  let tenant = want ? all.find((t) => t.id === want || t.name.toLowerCase() === want.toLowerCase()) : all.find((t) => bankOf(t.settings));
  if (!tenant) { console.error(want ? `No business "${want}".` : "No business has a payout bank account. Pass --tenant <id or name> --add-bank."); process.exit(1); }
  if (!bankOf(tenant.settings)) {
    if (!process.argv.includes("--add-bank")) { console.error(`${tenant.name} has no payout bank account (or collects its own payments). Add one in the business's Settings → Payments, or run again with --add-bank.`); process.exit(1); }
    const s = (tenant.settings ?? {}) as { payments?: Record<string, unknown> };
    const settings = { ...s, payments: { ...s.payments, mode: "shetal", payoutBank: { bank: "NIC Asia", holder: tenant.name, account: "0012345678901", branch: "Kathmandu" } } };
    tenant = await prisma.tenant.update({ where: { id: tenant.id }, data: { settings } , select: { id: true, name: true, settings: true } });
    console.log(`Added a sample bank account to ${tenant.name}.`);
  }
  const ago = (n: number) => { const d = dayOf(nepalDay()); d.setUTCDate(d.getUTCDate() - n); return ymd(d); };
  const S = (source: Collected["source"], ref: string, what: string, gross: number, daysAgo: number): Collected => ({ tenantId: tenant!.id, source, ref, what, gross, on: ago(daysAgo) });
  const samples: Collected[] = [
    S("booking", "SMP-BK-1", "Sample booking: Deluxe room, 2 nights", 12_000, 12),
    S("booking", "SMP-BK-2", "Sample booking: Family suite, 3 nights", 27_500, 9),
    S("rent", "SMP-RC-1", "Sample rent: October", 35_000, 7),
    S("commitment", "SMP-IN-1", "Sample instalment: plot booking", 150_000, 5),
    S("booking", "SMP-BK-3", "Sample booking: Deluxe room, 1 night", 6_500, 3),
    S("reservation", "SMP-RS-1", "Sample reservation fee", 20_000, 0),
    S("booking", "SMP-BK-2", "Sample refund: Family suite cancelled", -27_500, 4), // same ref as its payment
  ];
  let added = 0;
  for (const c of samples) if (await recordCollected(db, c)) added++;
  console.log(`${tenant.name}: ${added} sample payment${added === 1 ? "" : "s"} added${added < samples.length ? ` (${samples.length - added} already there)` : ""}.`);
  console.log("Admin → Billing → Payouts: run payouts (money older than the hold days is paid out; the rest waits).");
} finally {
  await prisma.$disconnect();
}
