// CRM: the Inbox of leads (enquiries from the website, chat channels and the lead finder), on the kernel since P2-W5.
// Where it fits: business/backend/src/app.ts registers leadRoutes with { prefix: "/v1", contextOf: businessContextOf, fetch }; the old route file is a shim.
// How it works: the context is capped at "branch" (PHASE_ONE_CAPS), so people keep today's view. The vault opens a chat channel's token for a reply; the
// mailer sends email replies; `fetch` lets tests replace the chat network calls.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { capContext } from "@sheetal/platform/core/scope-cap";
import { Vault } from "@sheetal/platform/auth/vault";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import { LeadController } from "./lead.controller.js";
import { LeadService, type Mailer } from "./lead.service.js";

export interface LeadRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext>; fetch?: Fetch }

export async function leadRoutes(app: FastifyInstance, opts: LeadRoutesOptions) {
  const host = app as FastifyInstance & { mailer?: Mailer; config: { SECRETS_KEY: string; NODE_ENV: string } };
  const service = new LeadService({
    bus: busOf(app, "crm"),
    vault: new Vault(host.config.SECRETS_KEY, host.config.NODE_ENV === "production"),
    mailer: () => { if (!host.mailer) throw new Error("The CRM app needs the mailer (app.mailer)."); return host.mailer; },
    fetch: opts.fetch,
  });
  new LeadController(service, async (req) => capContext(await opts.contextOf(req), "crm")).register(app);
}
