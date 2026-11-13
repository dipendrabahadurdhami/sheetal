// The table code of the lead finder and of incoming chat messages (KERNEL.md section 6). Moved out of business/backend/src/modules/growth/routes.ts in P2-W6.
// Where it fits: FinderService calls these, in its transaction for a change.
// Rules: the lead finder's queries carry the business of the context; a webhook message carries the business of the connected channel it came to.

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export class FinderRepository {
  planOf(d: Tx, tenantId: string) { return d.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true } }).then((t) => t.plan); }
  addLead(d: Tx, data: Prisma.LeadUncheckedCreateInput) { return d.lead.create({ data }); }
  audit(d: Tx, row: { tenantId: string; actorId: string | null; action: string; target: string; ip: string }) { return d.auditLog.create({ data: row }); }
  metaSetting(d: Tx) { return d.appSetting.findUnique({ where: { key: "meta" } }); }
  channel(d: Tx, externalId: string) { return d.channelAccount.findUnique({ where: { externalId } }); }
  openLead(d: Tx, tenantId: string, contactKey: string) { return d.lead.findFirst({ where: { tenantId, contactKey, status: { notIn: ["won", "lost"] } }, orderBy: { lastAt: "desc" } }); }
  sameMessage(d: Tx, leadId: string, body: string, at: Date) { return d.leadMessage.findFirst({ where: { leadId, body, createdAt: at } }); }
  addMessage(d: Tx, leadId: string, body: string, at: Date) {
    return Promise.all([d.leadMessage.create({ data: { leadId, direction: "in", body, createdAt: at } }), d.lead.update({ where: { id: leadId }, data: { lastAt: at } })]);
  }
}
