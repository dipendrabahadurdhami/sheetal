import type { Prisma } from "@prisma/client";
import { roleTemplatesFor, type BusinessType } from "../../domain/permissions.js";
import { starterPlanId } from "../../domain/plans.js";

// Every account gets its own business workspace from day one, on the free Starter plan.

type Tx = Prisma.TransactionClient;

/** Create the business's ready-made roles (owner, manager, agent…) and return them by key. */
export async function createRoles(tx: Tx, tenantId: string, type: BusinessType) {
  const roles = roleTemplatesFor(type);
  await tx.role.createMany({ data: roles.map((r) => ({ tenantId, key: r.key, perms: r.perms, system: true })) });
  const rows = await tx.role.findMany({ where: { tenantId } });
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

export async function createWorkspace(tx: Tx, opts: { ownerId: string; name: string; type: BusinessType; planId?: string; email?: string; phone?: string; city?: string; period?: number; renewsAt?: Date; emailVerified?: boolean }) {
  const tenant = await tx.tenant.create({
    data: {
      name: opts.name, type: opts.type, planId: opts.planId ?? starterPlanId(opts.type), email: opts.email, phone: opts.phone, city: opts.city,
      status: "active", period: opts.period ?? 1, renewsAt: opts.renewsAt, emailVerified: opts.emailVerified ?? false,
    },
  });
  const roles = await createRoles(tx, tenant.id, opts.type);
  await tx.membership.create({ data: { userId: opts.ownerId, tenantId: tenant.id, roleId: roles.owner!.id } });
  return tenant;
}
