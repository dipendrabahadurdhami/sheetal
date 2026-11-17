// `npm run roles:sync`: gives every existing business the standard roles its type now has (Manager, Customer care, Viewer and any later ones).
// Without --apply it only says what it would add. Run it once after a deploy that adds a role to the templates; safe to run again.
// Rules: it only ADDS a role the business does not have yet. A role that exists (even one an owner edited) is never changed, a person's role is
// never changed, and nothing is deleted. Demo businesses are skipped (they are throw-away).
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { roleTemplatesFor, type BusinessType } from "../src/domain/permissions.js";

loadEnvFiles();
const apply = process.argv.includes("--apply");
const config = loadConfig(process.env, "website");
const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });

try {
  const tenants = await prisma.tenant.findMany({ where: { demo: false }, select: { id: true, name: true, type: true, roles: { select: { key: true } } }, orderBy: { createdAt: "asc" } });
  let added = 0;
  for (const t of tenants) {
    const have = new Set(t.roles.map((r) => r.key));
    const missing = roleTemplatesFor(t.type as BusinessType).filter((r) => !have.has(r.key));
    if (!missing.length) continue;
    console.log(`${t.name} (${t.type}): ${apply ? "adds" : "would add"} ${missing.map((r) => r.key).join(", ")}`);
    if (apply) await prisma.role.createMany({ data: missing.map((r) => ({ tenantId: t.id, key: r.key, perms: r.perms, system: true })), skipDuplicates: true });
    added += missing.length;
  }
  console.log(added ? `${apply ? "Added" : "Would add"} ${added} role${added > 1 ? "s" : ""}.${apply ? "" : " Run again with --apply to write them."}` : "Every business already has all the standard roles.");
} finally {
  await prisma.$disconnect();
}
