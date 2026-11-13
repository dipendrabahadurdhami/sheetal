// The website's door into the business apps' write rules (P2-W6): leads go through the CRM app's LeadIntake, signatures through the Agreements app's
// recordSigning, so each website write gets its audit line and its event in the same transaction as the change.
// Where it fits: engage (enquiries), forms (online-form answers), public (the public API) and sign (agreement signing) routes.
// How it works: this API process has no event dispatcher of its own; events are written to the outbox table and the business API's dispatcher
// delivers them. The bus checks event names against the manifests in development and tests (strict) and only logs in production.
// Rules: one bus for the process; the database comes from the app when a request runs.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { OutboxEventBus } from "@sheetal/platform/core/events";
import { dbOf } from "@sheetal/platform/db/client";
import { APPS } from "@sheetal/platform/tenancy/apps.generated";
import { LeadIntake, type IntakeInfo } from "@sheetal/app-crm/backend/intake";

const PUBLISHES = new Set(APPS.flatMap((a) => a.events.publishes.map((e) => e.name)));
export const websiteBus = new OutboxEventBus({ mayPublish: (name) => PUBLISHES.has(name), strict: process.env.NODE_ENV !== "production" });

/** The CRM app's lead intake on this app's database. */
export const leadIntake = (app: FastifyInstance) => new LeadIntake(dbOf(app) as never, websiteBus);
/** Who and where a request came from, for the audit line and the event. */
export const infoOf = (request: FastifyRequest): IntakeInfo => ({ requestId: request.id, ip: request.ip, log: request.log, userId: (request as { user?: { id: string } }).user?.id ?? null });
