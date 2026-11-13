// Business email: the routes moved to the Workspace app (apps/workspace/backend, registered by workspaceRoutes) in P2-W6 (Workspace part 2). This file
// keeps the old names: mailRoutes registers nothing (so no route is registered twice); cleanHtml is re-exported.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";
export { cleanHtml } from "@sheetal/app-workspace/backend/mail.service";
export interface MailOptions { resolver?: unknown }

export async function mailRoutes(_app: FastifyInstance, _opts: MailOptions) { /* moved: see apps/workspace/backend */ }
