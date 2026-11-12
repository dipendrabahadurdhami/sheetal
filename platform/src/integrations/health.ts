// The health job of the Integration Center (INTEGRATIONS.md section 12).
// Where it fits: an API with the admin work in it adds integrationHealthJob() to its job list (admin/backend). Every 15 minutes each LIVE connection gets one
// cheap, read-only probe.
// Rules: three failures in a row mark a connection "down" and tell the people who manage it once; the first success clears it and says "back to normal".
// Nothing is ever paused by this job: a person's choice is not overwritten.

import type { JobSpec } from "../jobs/registry.js";
import { notify, notifyStaff } from "../notify/index.js";
import type { Db } from "../db/client.js";
import type { IntegrationService } from "./service.js";

export const INTEGRATION_HEALTH_EVERY_MS = 15 * 60_000;
export const INTEGRATION_HEALTH_FIRST_RUN_MS = 3 * 60_000;

export function integrationHealthJob(db: Db, service: IntegrationService, log: { info(o: object, msg?: string): void }): JobSpec {
  return {
    id: "integrations.health", everyMs: INTEGRATION_HEALTH_EVERY_MS, firstRunMs: INTEGRATION_HEALTH_FIRST_RUN_MS, failMessage: "integration health failed",
    run: async () => {
      const r = await service.runHealth(async ({ row, alert, name, message }) => {
        const title = alert === "down" ? `${name} is not answering` : `${name} is back to normal`;
        const body = alert === "down" ? `Three checks in a row failed: ${message} Nothing was switched off; it is hidden from use until it answers again.` : "The connection answers again.";
        if (row.scope === "platform" || !row.tenantId) await notifyStaff(db, "platform.integration.manage", { type: "integration.health", title, message: body, link: "/admin/setup" });
        else {
          const owners = await db.membership.findMany({ where: { tenantId: row.tenantId, status: "active", role: { key: "owner" } }, select: { userId: true } });
          await notify(db, owners.map((o) => o.userId), { type: "integration.health", tenantId: row.tenantId, title, message: body, link: "/business/settings" });
        }
      });
      if (r.down) log.info(r, "integration health: connections down");
    },
  };
}
