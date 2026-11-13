// A signature made on the website (/sign/<token>): the audit line and the event, written in the signing transaction (P2-W6).
// Where it fits: website/backend/src/modules/sign/routes.ts keeps the signing flow, rules and emails exactly as before (the person signing has no
// business context) and calls recordSigning() inside its transaction, so every signature leaves the same trail as a change made in the business panel.
// How it works: one audit line per signature ("agreement.signed", with the typed name), plus "agreement.completed" when the last person signs; the
// events "agreements.agreement.signed" and "agreements.agreement.completed" go to the outbox with the small system context.
// Rules: call it inside the transaction that records the signature; nothing here sends mail or notifications.

import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@prisma/client";
import type { EventBus } from "@sheetal/platform/core/events";

type Tx = Prisma.TransactionClient;
export interface SigningInfo { requestId: string; ip: string; log: FastifyBaseLogger }
export interface Signing { tenantId: string; agreementId: string; ref: string; branchId: string | null; signerId: string; signerName: string; complete: boolean }

export async function recordSigning(tx: Tx, bus: EventBus, info: SigningInfo, s: Signing) {
  const ctx = { requestId: info.requestId, ip: info.ip, now: new Date(), log: info.log, db: null, tx, actor: { kind: "system", job: "website.sign" }, business: { id: s.tenantId } };
  await tx.auditLog.create({ data: { tenantId: s.tenantId, actorId: null, action: "agreement.signed", target: s.ref, ip: info.ip, meta: { agreementId: s.agreementId, signerId: s.signerId, name: s.signerName } } });
  await bus.publish(ctx as never, "agreements.agreement.signed", { id: s.agreementId, ref: s.ref }, 1, { branchId: s.branchId });
  if (s.complete) {
    await tx.auditLog.create({ data: { tenantId: s.tenantId, actorId: null, action: "agreement.completed", target: s.ref, ip: info.ip, meta: { agreementId: s.agreementId } } });
    await bus.publish(ctx as never, "agreements.agreement.completed", { id: s.agreementId, ref: s.ref }, 1, { branchId: s.branchId });
  }
}
