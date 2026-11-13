// What the POS and Stock services share: the permission lists and the base service they both extend (one write = one transaction with its audit line and
// its event). Rules: "any of" lists, as before: a person needs at least one of them.

import { z } from "zod";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { forbidden } from "@sheetal/platform/core/errors";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BranchEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";

export const SETTINGS = "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete";

export function need(ctx: BusinessContext, ...perms: string[]) { if (!perms.some((p) => ctx.permissions.can(p))) throw forbidden("Your role can't do this."); }
export const canAny = (ctx: BusinessContext, perms: string[]) => perms.some((p) => ctx.permissions.can(p));

type Bill = BranchEntity & { seq: number };
/** The base repository the kernel service needs (POS bills); the named queries are in repositories.ts. */
class BillBase extends BaseRepository<Bill, never, never> {
  constructor() { super({ model: "posBill", ownerField: null, label: "This bill", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
}

export abstract class PosBase extends BaseService<Bill, never, never> {
  constructor(resource: string, bus: EventBus) {
    super({
      app: "pos", resource, repo: new BillBase(),
      permissions: { read: "pos.restaurant.use", create: "pos.restaurant.use", update: "pos.restaurant.use", delete: "pos.restaurant.use" },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: resource, label: (b) => b.id }, bus, requireVersion: false,
    });
  }
  /** One change: ONE transaction with its audit line (when the old code wrote one) and its event. A read-only support session changes nothing. */
  protected write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => { audit?: { action: string; target: string }; event: { name: string; payload: object; branchId?: string | null } }): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      if (a.audit) await this.writeAudit(tx, a.audit.action, a.audit.target);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1, { branchId: a.event.branchId ?? null });
      return r;
    });
  }
}
