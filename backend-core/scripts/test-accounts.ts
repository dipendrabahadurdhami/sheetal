// `npm run accounts:test`: makes ready-to-use test accounts on THIS computer's database, so every panel can be tried
// by hand: Sheetal staff (one per staff role), a business of every type on every plan (Starter, Business, Pro) with
// its whole team (one person per role, and one limited to a second branch), and website users (a buyer and a renter).
// It also fills an agency with sample rentals, expenses and payouts. Every account gets the same password.
// Usage: npm run accounts:test -- [--password <password>]     (default password: Test@12345)
// The list of emails and passwords is printed and saved to test-accounts.csv in the project folder.
// Safe to run again: what exists is left as it is (passwords included). Refuses to run when NODE_ENV=production.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { hashPassword } from "@sheetal/platform/auth/secrets";
import { createWorkspace } from "../src/modules/accounts/workspace.js";
import { BUSINESS_TYPES, roleTemplatesFor, type BusinessType } from "../src/domain/permissions.js";
import { listingCode, prefixFor } from "../src/domain/codes.js";
import { nepalDay, recordCollected } from "../src/domain/payouts.js";
import { runRentBills } from "@sheetal/app-rentals/backend/bills";
import { dayOf, ymd } from "../src/domain/money.js";

loadEnvFiles();
const config = loadConfig(process.env, "website");
if (process.env.NODE_ENV === "production") { console.error("This makes test accounts. It doesn't run with NODE_ENV=production."); process.exit(1); }
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const PASSWORD = arg("--password") || "Test@12345";
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
const rows: string[][] = [["panel", "who", "email", "password", "business", "role"]];
let hash = "";

async function user(email: string, name: string, o: { platformRole?: string; phone?: string; userType?: string } = {}) {
  const found = await db.user.findUnique({ where: { email } });
  if (found) return found;
  return db.user.create({ data: { email, userName: name, emailVerifiedAt: new Date(), passwordHash: hash, platformRole: o.platformRole ?? null, phone: o.phone, userType: o.userType ?? (o.platformRole ? "staff" : "agent") } });
}

const TYPE_NAME: Record<BusinessType, string> = { hotel: "Hotel", host: "Homestay", developer: "Builders", agency: "Realty", sponsor: "Capital" };
const PLAN_NAME = { starter: "Starter", business: "Business", pro: "Pro" } as const;

try {
  hash = await hashPassword(PASSWORD);
  // ───── Sheetal staff (admin panel) ─────
  for (const [role, label] of [["super_admin", "Super admin"], ["operations", "Operations"], ["finance", "Finance"], ["content_editor", "Content editor"], ["support", "Support"]] as const) {
    const email = `${role.replace("_", ".")}@sheetal.test`;
    await user(email, `Test ${label}`, { platformRole: role });
    rows.push(["Admin", label, email, PASSWORD, "", role]);
  }

  // ───── A business of every type on every plan, with its team ─────
  let n = 0;
  for (const type of BUSINESS_TYPES) {
    for (const plan of ["starter", "business", "pro"] as const) {
      n++;
      const slug = `${type}.${plan}`;
      const bizName = `Test ${TYPE_NAME[type]} ${PLAN_NAME[plan]}`;
      const owner = await user(`owner.${slug}@sheetal.test`, `${bizName} Owner`, { phone: `98000${String(10000 + n).slice(-5)}` });
      let tenant = await db.tenant.findFirst({ where: { name: bizName } });
      if (!tenant) tenant = await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: bizName, type, planId: `${type}-${plan}`, email: owner.email, city: "Kathmandu", period: 12, renewsAt: new Date(Date.now() + 365 * 864e5), emailVerified: true }));
      rows.push(["Business", "Owner", owner.email, PASSWORD, bizName, "owner"]);
      if (plan === "starter") continue; // Starter has one seat: the owner
      // A second branch, so branch limits can be tried.
      const second = (await db.branch.findFirst({ where: { tenantId: tenant.id, name: "Pokhara" } })) ?? (await db.branch.create({ data: { tenantId: tenant.id, name: "Pokhara" } }));
      for (const t of roleTemplatesFor(type).filter((r) => r.key !== "owner")) {
        const email = `${t.key.replace(/_/g, ".")}.${slug}@sheetal.test`;
        const u = await user(email, `${bizName} ${t.key.replace(/_/g, " ")}`);
        const role = await db.role.findFirstOrThrow({ where: { tenantId: tenant.id, key: t.key } });
        if (!(await db.membership.findFirst({ where: { tenantId: tenant.id, userId: u.id } }))) await db.membership.create({ data: { tenantId: tenant.id, userId: u.id, roleId: role.id, status: "active" } });
        rows.push(["Business", t.key.replace(/_/g, " "), email, PASSWORD, bizName, t.key]);
      }
      // One person who only works at the Pokhara branch (the first non-owner role).
      const first = roleTemplatesFor(type).find((r) => r.key !== "owner")!;
      const email = `pokhara.${slug}@sheetal.test`;
      const u = await user(email, `${bizName} Pokhara staff`);
      const role = await db.role.findFirstOrThrow({ where: { tenantId: tenant.id, key: first.key } });
      if (!(await db.membership.findFirst({ where: { tenantId: tenant.id, userId: u.id } }))) await db.membership.create({ data: { tenantId: tenant.id, userId: u.id, roleId: role.id, status: "active", scopes: [second.name] } });
      rows.push(["Business", `${first.key.replace(/_/g, " ")} (Pokhara only)`, email, PASSWORD, bizName, first.key]);
    }
  }

  // ───── Website users ─────
  const buyer = await user("buyer@sheetal.test", "Test Buyer", { phone: "9811111111", userType: "buyer" });
  const renter = await user("renter@sheetal.test", "Test Renter", { phone: "9812222222", userType: "buyer" });
  rows.push(["Website", "Buyer", buyer.email, PASSWORD, "", ""], ["Website", "Renter (has a lease)", renter.email, PASSWORD, "", ""]);

  // ───── Sample data in the agency on the Business plan ─────
  const agency = await db.tenant.findFirstOrThrow({ where: { name: "Test Realty Business" } });
  const head = await db.branch.findFirstOrThrow({ where: { tenantId: agency.id, name: "Head office" } });
  const ownerUser = await db.user.findUniqueOrThrow({ where: { email: "owner.agency.business@sheetal.test" } });
  const today = nepalDay(), month = today.slice(0, 7);
  const ago = (days: number) => { const d = dayOf(today); d.setUTCDate(d.getUTCDate() - days); return ymd(d); };
  if (!(await db.rentOwner.count({ where: { tenantId: agency.id } }))) {
    // Payouts: Sheetal collects for this agency, and it has a bank account.
    const s = (agency.settings ?? {}) as { payments?: Record<string, unknown> };
    await db.tenant.update({ where: { id: agency.id }, data: { settings: { ...s, payments: { ...s.payments, mode: "shetal", payoutBank: { bank: "NIC Asia", holder: agency.name, account: "0012345678901", branch: "Kathmandu" } } } } });
    // A listing on the website for the rented flat.
    const l = await db.listing.create({ data: { code: `TMP-${Date.now()}`, slug: `tmp-${Date.now()}`, tenantId: agency.id, branchId: head.id, userId: ownerUser.id, kind: "rentout", purpose: "rent", category: "Apartment", propertyType: "Flat", title: "2 BHK flat on rent in Sanepa", status: "published", publishedAt: new Date(), price: 25_000n, pricePer: "month", district: "Lalitpur", area: "Sanepa" } });
    const code = listingCode(await prefixFor(db, agency.id), l.id);
    await db.listing.update({ where: { id: l.id }, data: { code, slug: `2-bhk-flat-on-rent-in-sanepa-${l.id}` } });
    // Rentals: an owner, two units, one let to the test renter (linked to their account).
    const o = await db.rentOwner.create({ data: { tenantId: agency.id, branchId: head.id, name: "Ram Thapa", phone: "9801000000", feeBp: 800, bank: "Nabil Bank 1234" } });
    const flat = await db.rentUnit.create({ data: { tenantId: agency.id, branchId: head.id, ownerId: o.id, property: "Sanepa Apartments", name: "Flat 2A", kind: "2 BHK", rent: 25_000, status: "let", listingId: l.id } });
    await db.rentUnit.create({ data: { tenantId: agency.id, branchId: head.id, ownerId: o.id, property: "Sanepa Apartments", name: "Shop 1", kind: "Shop", rent: 18_000 } });
    const start = dayOf(`${month}-01`); start.setUTCMonth(start.getUTCMonth() - 2);
    const end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 1); end.setUTCDate(end.getUTCDate() - 1);
    await db.rentLease.create({ data: { tenantId: agency.id, branchId: head.id, unitId: flat.id, renter: "Test Renter", phone: "9812222222", email: renter.email, userId: renter.id, startOn: start, endOn: end, rent: 25_000, deposit: 50_000, createdBy: ownerUser.id } });
    await runRentBills(db, { today, tenantId: agency.id });
    rows.push(["Website", "Pay rent with", code, "mobile 9812222222", agency.name, "property code"]);
    // Expenses: two this month and a monthly rent.
    await db.expense.create({ data: { tenantId: agency.id, branchId: head.id, status: "confirmed", spentOn: dayOf(ago(3)), category: "salaries", amount: 45_000, vendor: "Staff", method: "bank", createdBy: ownerUser.id, confirmedBy: ownerUser.id, confirmedAt: new Date() } });
    await db.expense.create({ data: { tenantId: agency.id, branchId: head.id, status: "confirmed", spentOn: dayOf(ago(1)), category: "marketing", amount: 8_000, vendor: "Facebook ads", method: "card", createdBy: ownerUser.id, confirmedBy: ownerUser.id, confirmedAt: new Date() } });
    await db.recurringExpense.create({ data: { tenantId: agency.id, branchId: head.id, category: "rent", amount: 30_000, vendor: "Office landlord", method: "bank", dayOfMonth: 1, startMonth: month, createdBy: ownerUser.id } });
    // Payouts: money Sheetal collected for the agency (old enough to pay out, and one still on hold).
    for (const [ref, gross, days] of [["TEST-BK-1", 40_000, 10], ["TEST-BK-2", 15_000, 6], ["TEST-BK-3", 9_000, 0]] as const) {
      await recordCollected(db, { tenantId: agency.id, branchId: head.id, source: "booking", ref, what: `Test booking ${ref}`, gross, on: ago(days) });
    }
  }

  const csv = rows.map((r) => r.map((x) => (/[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")).join("\r\n");
  const file = fileURLToPath(new URL("../../test-accounts.csv", import.meta.url));
  writeFileSync(file, csv);
  console.log(rows.slice(1).map((r) => `${r[0].padEnd(9)} ${r[1].padEnd(28)} ${r[2].padEnd(46)} ${r[3]}${r[4] ? `   ${r[4]}` : ""}`).join("\n"));
  console.log(`\n${rows.length - 1} lines saved to test-accounts.csv. Password for every account: ${PASSWORD}`);
} finally {
  await db.$disconnect();
}
