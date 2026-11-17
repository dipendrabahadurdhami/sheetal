// Workspace: a business's branches and its own settings (Settings → Branches and the Settings tabs, the branch picker, listing check-ups), on the kernel
// since P2-W5/W6, and its team (the person's businesses, profile, branding, Pro cover, members, invitations, roles) the business Overview,
// Import / Export, online forms, business email and the growth tools (analytics, channels, AI meter) since P2-W6 part 2.
// Where it fits: business/backend/src/app.ts registers workspaceRoutes with { prefix: "/v1", contextOf: businessContextOf }; the old branch and settings
// route files are shims. How it works: the vault seals secret settings; the catalog is the listing setup staff keep in Admin (cached a minute).

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { Vault } from "@sheetal/platform/auth/vault";
import { cached } from "@sheetal/backend-core/lib/cache";
import { catalogKindsNow, readCatalog } from "@sheetal/backend-core/lib/catalog";
import { mediaBase } from "@sheetal/backend-core/lib/photos";
import { readPrivateFile } from "@sheetal/platform/files/private";
import { requireUser } from "@sheetal/platform/auth/sessions";
import { WorkspaceController } from "./workspace.controller.js";
import { WorkspaceService } from "./workspace.service.js";
import { DataController } from "./data.controller.js";
import { GrowthController } from "./growth.controller.js";
import { GrowthService } from "./growth.service.js";
import type { AiClient } from "@sheetal/backend-core/lib/ai";
import { MailController } from "./mail.controller.js";
import { MailService } from "./mail.service.js";
import { systemResolver, type Resolver } from "./mail-dns.js";
import { DataService } from "./data.service.js";
import { FormController } from "./form.controller.js";
import { FormService } from "./form.service.js";
import { OverviewController } from "./overview.controller.js";
import { OverviewService } from "./overview.service.js";
import { TeamController } from "./team.controller.js";
import { AppSettingsController } from "./app-settings.controller.js";
import { AppSettingsService } from "./app-settings.service.js";
import { SettingsService } from "@sheetal/platform/settings/service";
import { TeamService, type TeamUser } from "./team.service.js";

export interface WorkspaceRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext>; /** DNS lookups for email domains (tests swap it). */ resolver?: Resolver;
  /** The AI to use (tests swap it); otherwise the business's own key or Sheetal's. */ ai?: { client: AiClient; model: string; credits: Record<string, number>; own?: boolean; cap?: number } }

export async function workspaceRoutes(app: FastifyInstance, opts: WorkspaceRoutesOptions) {
  const host = app as FastifyInstance & { db?: unknown; cache?: unknown; config: { SECRETS_KEY: string; NODE_ENV: string; MEDIA_DIR: string; SITE_URL: string; MAIL_HOST: string; MAIL_INBOUND_SECRET?: string }; mailer: { send(m: { to: string; subject: string; text: string }): Promise<unknown> } };
  const service = new WorkspaceService({
    bus: busOf(app, "workspace"),
    vault: new Vault(host.config.SECRETS_KEY, host.config.NODE_ENV === "production"),
    mediaDir: host.config.MEDIA_DIR, mediaBase: mediaBase(host.config as never),
    catalog: () => cached(host.cache as never, "catalog:stored", 60, () => readCatalog(host.db as never)),
  });
  new WorkspaceController(service, opts.contextOf).register(app);
  new OverviewController(new OverviewService(), opts.contextOf).register(app);
  new DataController(new DataService({ bus: busOf(app, "workspace"), catalogKinds: () => catalogKindsNow(host.db as never) }), opts.contextOf).register(app);
  new GrowthController(new GrowthService({ bus: busOf(app, "workspace"), db: host.db, vault: new Vault(host.config.SECRETS_KEY, host.config.NODE_ENV === "production"), ai: opts.ai }), opts.contextOf).register(app);
  new MailController(new MailService({
    bus: busOf(app, "workspace"), db: host.db, vault: new Vault(host.config.SECRETS_KEY, host.config.NODE_ENV === "production"),
    resolver: opts.resolver ?? systemResolver, mailHost: host.config.MAIL_HOST, inboundSecret: host.config.MAIL_INBOUND_SECRET, log: app.log,
  }), opts.contextOf).register(app);
  new FormController(new FormService({ bus: busOf(app, "workspace"), siteUrl: host.config.SITE_URL, readFile: (name) => readPrivateFile(host.config.MEDIA_DIR, "forms", name) as never }), opts.contextOf).register(app);
  const team = new TeamService({
    bus: busOf(app, "workspace"), db: host.db, siteUrl: host.config.SITE_URL, mediaDir: host.config.MEDIA_DIR, mediaBase: mediaBase(host.config as never),
    mail: (m) => host.mailer.send(m),
  });
  new TeamController(team, opts.contextOf, (req) => requireUser(req) as unknown as TeamUser).register(app);
  // One Settings tab per app: the business-scope settings of the app manifests, through the typed settings store (P2-W6).
  let store: SettingsService | null = null;
  new AppSettingsController(new AppSettingsService(() => (store ??= new SettingsService(host.db as never, app.log))), opts.contextOf).register(app);
}
