// CRM: the Inbox of leads (enquiries from the website, chat channels and the lead finder), on the kernel since P2-W5; the lead finder and Meta's
// webhook since P2-W6 (finder.*).
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
import { FinderController } from "./finder.controller.js";
import { FinderService, type Ai } from "./finder.service.js";

export interface LeadRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext>; fetch?: Fetch; /** The AI to use (tests swap it); otherwise the business's own key or Sheetal's. */ ai?: Ai }

export async function leadRoutes(app: FastifyInstance, opts: LeadRoutesOptions) {
  const host = app as FastifyInstance & { db?: unknown; mailer?: Mailer; config: { SECRETS_KEY: string; NODE_ENV: string } };
  const service = new LeadService({
    bus: busOf(app, "crm"),
    vault: new Vault(host.config.SECRETS_KEY, host.config.NODE_ENV === "production"),
    mailer: () => { if (!host.mailer) throw new Error("The CRM app needs the mailer (app.mailer)."); return host.mailer; },
    fetch: opts.fetch,
  });
  const ctxOf = async (req: FastifyRequest) => capContext(await opts.contextOf(req), "crm");
  new LeadController(service, ctxOf).register(app);
  new FinderController(new FinderService({ bus: busOf(app, "crm"), db: host.db, vault: new Vault(host.config.SECRETS_KEY, host.config.NODE_ENV === "production"), ai: opts.ai }), ctxOf).register(app);
}
