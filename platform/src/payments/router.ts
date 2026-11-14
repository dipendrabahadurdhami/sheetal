// The payment router (MARKETPLACE-AND-BILLING.md section 12, P3-BE-9): which ways to pay a checkout may offer, kept strictly in two systems.
// Where it fits: every checkout asks resolvePaymentMethods() before showing buttons and assertMethodFor() again before charging. Sheetal's
// purposes (app subscriptions, the website, rent Sheetal manages) use ONLY Sheetal's platform connections; a business's purposes (its
// invoices, POS, its own rent) use ONLY that business's connections, then its free static QR and "record cash or bank by hand".
// How it works: a connection is offered when the Integration Center says it is usable (live and not down; outside production a test-mode
// connection with details also counts, as today) and, in production, it is in live mode, unless staff ask for test mode. A paused or down
// connection is simply not offered. There is NO fall-back from one system to the other (INTEGRATIONS.md section 14: a legal and accounting
// problem), and a payment made in test mode is recorded as mode "test" so it never reaches revenue.
// Rules: pure except loadPaymentConnections(). The router never reads a secret.

import type { Db } from "../db/client.js";
import { INTEGRATIONS } from "../integrations/registry.js";
import { usable } from "../integrations/state.js";
import type { ConnectionState, HealthStatus, Mode } from "../integrations/types.js";

export const SHEETAL_PURPOSES = ["sheetal.subscription", "sheetal.website", "sheetal.managed_rent"] as const;
export const BUSINESS_PURPOSES = ["business.invoice", "business.pos", "business.rent_self"] as const;
export type PaymentPurpose = (typeof SHEETAL_PURPOSES)[number] | (typeof BUSINESS_PURPOSES)[number];
export const isSheetalPurpose = (p: PaymentPurpose) => (SHEETAL_PURPOSES as readonly string[]).includes(p);

export interface ConnectionRow { id: string; integrationId: string; scope: string; tenantId: string | null; state: string; mode: string; healthStatus: string }

export type PaymentMethod =
  | { kind: "gateway"; integrationId: string; connectionId: string; owner: "sheetal" | "business"; mode: Mode }
  | { kind: "static_qr"; owner: "business" }
  | { kind: "manual"; owner: "sheetal" | "business" };

/** The integrations that take money at a checkout (the Integration Center's "payments" group). */
export const PAYMENT_INTEGRATIONS: readonly string[] = INTEGRATIONS.map((i) => i.describe()).filter((s) => s.group === "payments").map((s) => s.id);

type Env = "development" | "test" | "production";

/** Whether this connection belongs to the system the purpose must use. */
export function ownsPurpose(c: Pick<ConnectionRow, "scope" | "tenantId">, purpose: PaymentPurpose, tenantId: string | null): boolean {
  if (isSheetalPurpose(purpose)) return c.scope === "platform" && !c.tenantId;
  return c.scope === "business" && !!tenantId && c.tenantId === tenantId;
}

export function resolvePaymentMethods(o: {
  purpose: PaymentPurpose; tenantId: string | null; connections: ConnectionRow[]; env: Env;
  /** Staff testing a checkout on purpose: test-mode connections may show in production too. */
  staffTest?: boolean;
  /** The business has a static QR picture saved (business purposes only). */
  staticQr?: boolean;
  /** Sheetal accepts bank transfer with a proof (Sheetal purposes only). */
  bankTransfer?: boolean;
}): PaymentMethod[] {
  const sheetal = isSheetalPurpose(o.purpose);
  const out: PaymentMethod[] = [];
  for (const c of o.connections) {
    if (!PAYMENT_INTEGRATIONS.includes(c.integrationId) || !ownsPurpose(c, o.purpose, o.tenantId)) continue;
    const state = c.state as ConnectionState, mode = c.mode as Mode, health = c.healthStatus as HealthStatus;
    if (!usable({ state, mode, health }, o.env)) continue;
    if (o.env === "production" && mode !== "live" && !o.staffTest) continue;
    out.push({ kind: "gateway", integrationId: c.integrationId, connectionId: c.id, owner: sheetal ? "sheetal" : "business", mode });
  }
  if (sheetal) { if (o.bankTransfer) out.push({ kind: "manual", owner: "sheetal" }); }
  else {
    if (o.staticQr) out.push({ kind: "static_qr", owner: "business" });
    out.push({ kind: "manual", owner: "business" });
  }
  return out;
}

export class PaymentRouteError extends Error {}

/** Called again right before charging: refuses a connection from the other system, or one that is not offered now. */
export function assertMethodFor(o: Parameters<typeof resolvePaymentMethods>[0] & { connectionId: string }): Extract<PaymentMethod, { kind: "gateway" }> {
  const c = o.connections.find((x) => x.id === o.connectionId);
  if (c && !ownsPurpose(c, o.purpose, o.tenantId)) {
    throw new PaymentRouteError(isSheetalPurpose(o.purpose)
      ? "Sheetal's own payments can't go through a business's gateway."
      : "A business's customers can't pay through Sheetal's gateway.");
  }
  const m = resolvePaymentMethods(o).find((x) => x.kind === "gateway" && x.connectionId === o.connectionId);
  if (!m || m.kind !== "gateway") throw new PaymentRouteError("This way to pay isn't available right now. Choose another.");
  return m;
}

/** The connections a checkout may consider: Sheetal's for Sheetal's purposes, that one business's otherwise. */
export async function loadPaymentConnections(db: Db, purpose: PaymentPurpose, tenantId: string | null): Promise<ConnectionRow[]> {
  const where = isSheetalPurpose(purpose) ? { scope: "platform", tenantId: null } : { scope: "business", tenantId: tenantId ?? "__none__" };
  return db.integrationConnection.findMany({
    where: { ...where, integrationId: { in: [...PAYMENT_INTEGRATIONS] } },
    select: { id: true, integrationId: true, scope: true, tenantId: true, state: true, mode: true, healthStatus: true },
  });
}
