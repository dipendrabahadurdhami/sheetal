// Workspace: a business's branches and its own settings (Settings → Branches and the Settings tabs, the branch picker, listing check-ups), on the kernel
// since P2-W5/W6, and the business Overview since P2-W6 part 2. The team (members, roles, invites), import/export, forms, mail and growth are not moved yet (they are still in
// business/backend/src/modules).
// Where it fits: business/backend/src/app.ts registers workspaceRoutes with { prefix: "/v1", contextOf: businessContextOf }; the old branch and settings
// route files are shims. How it works: the vault seals secret settings; the catalog is the listing setup staff keep in Admin (cached a minute).

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { Vault } from "@sheetal/platform/auth/vault";
import { cached } from "@sheetal/backend-core/lib/cache";
import { readCatalog } from "@sheetal/backend-core/lib/catalog";
import { mediaBase } from "@sheetal/backend-core/lib/photos";
import { WorkspaceController } from "./workspace.controller.js";
import { WorkspaceService } from "./workspace.service.js";
import { OverviewController } from "./overview.controller.js";
import { OverviewService } from "./overview.service.js";

export interface WorkspaceRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext> }

export async function workspaceRoutes(app: FastifyInstance, opts: WorkspaceRoutesOptions) {
  const host = app as FastifyInstance & { db?: unknown; cache?: unknown; config: { SECRETS_KEY: string; NODE_ENV: string; MEDIA_DIR: string } };
  const service = new WorkspaceService({
    bus: busOf(app, "workspace"),
    vault: new Vault(host.config.SECRETS_KEY, host.config.NODE_ENV === "production"),
    mediaDir: host.config.MEDIA_DIR, mediaBase: mediaBase(host.config as never),
    catalog: () => cached(host.cache as never, "catalog:stored", 60, () => readCatalog(host.db as never)),
  });
  new WorkspaceController(service, opts.contextOf).register(app);
  new OverviewController(new OverviewService(), opts.contextOf).register(app);
}
