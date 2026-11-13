// Agreements (Business → Agreements), on the kernel since P2-W1 stage 3: make an agreement from a template, fill it in, send it for e-signing, follow the
// signatures, cancel, copy, and remove a draft. People sign on the website (/sign/<token>, website/backend/src/modules/sign), which is not moved.
// Where it fits: business/backend/src/app.ts registers agreementRoutes with { prefix: "/v1", contextOf: businessContextOf }; the old route file is a shim.
// The code is split by job: agreement.repository.ts (tables), agreement.service.ts (rules), agreement.controller.ts (HTTP), presenter.ts, mail.ts.
// How it works: the context is capped at "branch" (scope.ts). The mailer and the site address come from the API (app.mailer, app.config.SITE_URL).
// Rules: see agreement.service.ts.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { AgreementController } from "./agreement.controller.js";
import { AgreementService } from "./agreement.service.js";
import type { Mailer } from "./mail.js";
import { phaseOneContext } from "./scope.js";

export interface AgreementRoutesOptions {
  /** Builds the context of a request (business/backend/src/modules/access.ts businessContextOf). Passed in because an app does not import an API. */
  contextOf: (req: FastifyRequest) => Promise<BusinessContext>;
}

type Host = FastifyInstance & { mailer?: Mailer; config?: { SITE_URL?: string } };

export async function agreementRoutes(app: FastifyInstance, opts: AgreementRoutesOptions) {
  const host = app as Host;
  const service = new AgreementService({
    bus: busOf(app, "agreements"),
    mailer: () => { if (!host.mailer) throw new Error("The agreements app needs the mailer (app.mailer)."); return host.mailer; },
    site: (host.config?.SITE_URL ?? "").replace(/\/+$/, ""),
  });
  new AgreementController(service, async (req) => phaseOneContext(await opts.contextOf(req))).register(app);
}
