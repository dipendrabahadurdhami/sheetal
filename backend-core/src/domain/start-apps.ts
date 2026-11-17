// A new business starts on the per-app system with only the basics for its type; everything else is in the Marketplace.
// Where it fits: createWorkspace() calls startOnApps() for real sign-ups and "add a business" (not for demos or test accounts).
// How it works: the business goes to billingMode "apps", on its type's free Starter plan with no renewal date, and gets the free edition
// of each basic app (only if the catalog has a free edition for it). Nothing is paid and nothing renews; the Marketplace adds the rest.
// Rules: a basic app with no free edition is skipped, never an error; the owner can remove or add apps any time from the Marketplace.

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { SettingsService } from "@sheetal/platform/settings/service";
import { CATALOG_SETTING, withNewApps } from "@sheetal/platform/billing/catalog";
import type { BusinessType } from "./permissions.js";
import { starterPlanId } from "./plans.js";

type Tx = Prisma.TransactionClient;

/** The apps a new business of each type starts with. */
export const BASIC_APPS: Record<BusinessType, readonly string[]> = {
  agency: ["listings", "crm", "people", "invoicing", "expenses"],
  hotel: ["hotel", "crm", "people", "invoicing", "expenses"],
  host: ["hotel", "crm", "people", "invoicing", "expenses"],
  developer: ["projects", "crm", "people", "invoicing", "collections"],
  sponsor: ["investments", "crm", "people", "invoicing"],
};

export async function startOnApps(tx: Tx, tenantId: string, type: BusinessType): Promise<string[]> {
  const catalog = withNewApps(await new SettingsService(tx as never, { warn: () => undefined } as never).get(CATALOG_SETTING));
  const apps = (BASIC_APPS[type] ?? BASIC_APPS.agency).filter((id) => catalog.apps[id]?.freeEditionEnabled && catalog.apps[id]?.editions.free?.free);
  const now = new Date();
  await tx.tenant.update({ where: { id: tenantId }, data: { billingMode: "apps", planId: starterPlanId(type), status: "active", renewsAt: null } });
  for (const appId of apps) {
    const sub = await tx.subscription.create({ data: { id: randomUUID(), tenantId, appId, editionId: "free", status: "active", periodMonths: null, priceGrossPaisa: 0n, listPriceGrossPaisa: 0n, source: "install", installedAt: now } });
    await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, tenantId, appId, type: "installed", toStatus: "active", toEdition: "free", actorKind: "system", reason: "Started with the basics for this type of business", at: now } });
  }
  return apps;
}
