// First data: plans, the super admin and the Sheetal Property business (Agency Pro, 1 year).
// Safe to run again: it only adds what is missing and never overwrites passwords or edited plans.
//   npm run db:seed -w @sheetal/api
// Passwords come from .env (SUPER_ADMIN_PASSWORD, SHEETAL_OWNER_PASSWORD). If one is empty, the account is created
// without a password and a one-time "set your password" link is printed instead.
import { PrismaClient } from "@prisma/client";
import { PLANS } from "../src/domain/plans.js";
import { hashPassword, newToken, sha256 } from "../src/lib/secrets.js";
import { createWorkspace } from "../src/modules/accounts/workspace.js";

for (const file of [".env", "../.env"]) { try { process.loadEnvFile(file); } catch { /* optional */ } }

const db = new PrismaClient();
const site = (process.env.SITE_URL || "https://sheetalproperty.com").replace(/\/$/, "");

async function ensureUser(email: string, userName: string, password: string | undefined, extra: { platformRole?: string; phone?: string } = {}) {
  const lower = email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email: lower } });
  if (existing) {
    if (!existing.passwordHash && password) await db.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password) } });
    if (extra.platformRole && existing.platformRole !== extra.platformRole) await db.user.update({ where: { id: existing.id }, data: { platformRole: extra.platformRole } });
    console.log(`✓ ${lower} already exists`);
    return existing;
  }
  const user = await db.user.create({
    data: { email: lower, userName, emailVerifiedAt: new Date(), passwordHash: password ? await hashPassword(password) : null, platformRole: extra.platformRole, phone: extra.phone, userType: extra.platformRole ? "staff" : "agent" },
  });
  if (password) console.log(`✓ created ${lower}`);
  else {
    const token = newToken();
    await db.emailToken.create({ data: { userId: user.id, purpose: "reset_password", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600e3) } });
    console.log(`✓ created ${lower} without a password. Set it within 24 hours: ${site}/reset-password/${token}`);
  }
  return user;
}

async function main() {
  for (const p of PLANS) {
    await db.plan.upsert({ where: { id: p.id }, create: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort }, update: {} });
  }
  console.log(`✓ ${PLANS.length} plans`);

  await ensureUser(process.env.SUPER_ADMIN_EMAIL || "admin@sheetalproperty.com", "Sheetal Admin", process.env.SUPER_ADMIN_PASSWORD || undefined, { platformRole: "super_admin" });

  const owner = await ensureUser(process.env.SHEETAL_OWNER_EMAIL || "shetalrealestate@gmail.com", "Sheetal Property", process.env.SHEETAL_OWNER_PASSWORD || undefined, { phone: "+977 980-1136817" });
  const has = await db.membership.findFirst({ where: { userId: owner.id } });
  if (!has) {
    await db.$transaction((tx) => createWorkspace(tx, {
      ownerId: owner.id, name: "Sheetal Property", type: "agency", planId: "agency-pro", email: owner.email, phone: "+977 980-1136817", city: "Kathmandu",
      period: 12, renewsAt: new Date(Date.now() + 365 * 864e5), emailVerified: true,
    }));
    console.log("✓ Sheetal Property business on Agency Pro for 1 year");
  } else console.log("✓ Sheetal Property business already exists");
  // Sheetal's own logo on its agency card and profile (only if none has been uploaded).
  await db.tenant.updateMany({ where: { email: owner.email, type: "agency", logoUrl: null }, data: { logoUrl: "/brand/logo-mark.png" } });
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
