// `npm run people:roles`: gives the People permissions (people.view, people.manage) to the manager roles of businesses
// made before People existed: hotel managers, agency branch managers and developer sales managers. New businesses
// get it when they are created. Safe to run again: it only adds what is missing, and only to roles whose template
// (domain/permissions.ts) has it.
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "../src/config.js";
import { BUSINESS_TYPES, roleTemplatesFor, type BusinessType } from "../src/domain/permissions.js";

loadEnvFiles();
const config = loadConfig(process.env, "website");
const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
const NEW = ["people.view", "people.manage"];

try {
  let changed = 0;
  for (const type of BUSINESS_TYPES as readonly BusinessType[]) {
    for (const t of roleTemplatesFor(type)) {
      const give = NEW.filter((p) => t.perms.includes(p) && !t.perms.includes("*"));
      if (!give.length) continue;
      const roles = await prisma.role.findMany({ where: { key: t.key, system: true, tenant: { type } }, select: { id: true, perms: true } });
      for (const r of roles) {
        const missing = give.filter((p) => !r.perms.includes(p) && !r.perms.includes("*"));
        if (!missing.length) continue;
        await prisma.role.update({ where: { id: r.id }, data: { perms: [...r.perms, ...missing] } });
        changed++;
      }
    }
  }
  console.log(changed ? `Updated ${changed} role${changed > 1 ? "s" : ""}.` : "Every role is up to date.");
} finally {
  await prisma.$disconnect();
}
