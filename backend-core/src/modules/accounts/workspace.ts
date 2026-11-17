// Creating a business workspace: the business, its ready-made roles, its owner and its head office branch.
// Where it fits: sign-up, posting from the website, adding a business in the panel or the admin panel, and tests.
// How it works: one transaction; the business starts on its type's free Starter plan unless a plan is given. With
// trialDays above 0 (platform settings) a new business tries its type's Business plan: status "trial", renewsAt that
// many days ahead. When the trial ends without a payment the billing cycle moves it to Starter (domain/billing.ts).

import type { Prisma } from "@prisma/client";
import { roleTemplatesFor, type BusinessType } from "../../domain/permissions.js";
import { starterPlanId } from "../../domain/plans.js";
import { startOnApps } from "../../domain/start-apps.js";

export const HEAD_OFFICE = "Head office";

type Tx = Prisma.TransactionClient;

/** Create the business's ready-made roles (owner, manager, agent…) and return them by key. */
export async function createRoles(tx: Tx, tenantId: string, type: BusinessType) {
  const roles = roleTemplatesFor(type);
  await tx.role.createMany({ data: roles.map((r) => ({ tenantId, key: r.key, perms: r.perms, system: true })) });
  const rows = await tx.role.findMany({ where: { tenantId } });
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

export async function createWorkspace(tx: Tx, opts: { ownerId: string; name: string; type: BusinessType; planId?: string; email?: string; phone?: string; city?: string; period?: number; renewsAt?: Date; emailVerified?: boolean; trialDays?: number; /** Start on the per-app system with only the basics for the type (real sign-ups). */ startOnApps?: boolean }) {
  const trial = opts.trialDays && opts.trialDays > 0 && !opts.renewsAt ? new Date(Date.now() + opts.trialDays * 864e5) : undefined;
  const tenant = await tx.tenant.create({
    data: {
      name: opts.name, type: opts.type, planId: opts.planId ?? (trial ? `${opts.type}-business` : starterPlanId(opts.type)), email: opts.email, phone: opts.phone, city: opts.city,
      status: trial ? "trial" : "active", period: opts.period ?? 1, renewsAt: opts.renewsAt ?? trial, emailVerified: opts.emailVerified ?? false,
    },
  });
  const roles = await createRoles(tx, tenant.id, opts.type);
  await tx.branch.create({ data: { tenantId: tenant.id, name: HEAD_OFFICE } });
  await tx.membership.create({ data: { userId: opts.ownerId, tenantId: tenant.id, roleId: roles.owner!.id } });
  if (opts.startOnApps) await startOnApps(tx, tenant.id, opts.type);
  return tenant;
}
