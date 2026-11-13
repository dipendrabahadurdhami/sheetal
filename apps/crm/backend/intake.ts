// Leads that come in from outside a business panel: the website's enquiry forms, a business's online forms and the public API (P2-W6).
// Where it fits: website/backend (engage, forms, public routes) calls LeadIntake instead of writing the Lead table itself, so every lead from the
// website gets the same audit line and the same event ("crm.lead.received") as a chat message from the Meta webhook (finder.service.ts).
// How it works: receive() opens ONE transaction: the lead row, its audit line and, for a business's lead, the event in the outbox (the business API's
// dispatcher delivers it). receiveIn() does the same inside a transaction the caller already holds (a form answer writes its response row too).
// The caller has no business context (a visitor, a form, an API key), so the event carries the small system context used by the webhook.
// Rules: a lead for Sheetal itself (no business) gets the audit line but no event (events belong to a business). Notifications and emails stay
// with the caller, after the commit, as before.

import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@prisma/client";
import type { EventBus } from "@sheetal/platform/core/events";

type Tx = Prisma.TransactionClient;
type Db = { $transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> };
/** Where a lead came from, as the event and the audit line say it. */
export type IntakeChannel = "website" | "form" | "api";
export interface IntakeInfo { requestId: string; ip: string; log: FastifyBaseLogger; /** The signed-in visitor, if any. */ userId?: string | null }

export class LeadIntake {
  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  /** Creates the lead with its audit line and event in one transaction; returns the lead. */
  receive(info: IntakeInfo, data: Prisma.LeadUncheckedCreateInput, channel: IntakeChannel) {
    return this.db.$transaction((tx) => this.receiveIn(tx, info, data, channel));
  }

  /** The same, inside the caller's transaction. */
  async receiveIn(tx: Tx, info: IntakeInfo, data: Prisma.LeadUncheckedCreateInput, channel: IntakeChannel) {
    const lead = await tx.lead.create({ data: { ...data, createdBy: info.userId ?? null } });
    await tx.auditLog.create({ data: { tenantId: lead.tenantId, actorId: info.userId ?? null, action: "lead.received", target: lead.name, ip: info.ip, meta: { leadId: lead.id, channel } } });
    if (lead.tenantId) {
      const ctx = { requestId: info.requestId, ip: info.ip, now: new Date(), log: info.log, db: this.db, tx,
        actor: info.userId ? { kind: "user", userId: info.userId } : { kind: "system", job: `website.${channel}` }, business: { id: lead.tenantId } };
      await this.bus.publish(ctx as never, "crm.lead.received", { id: lead.id, channel }, 1, { branchId: lead.branchId });
    }
    return lead;
  }
}
