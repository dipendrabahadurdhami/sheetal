// The approvals routes: the inbox, deciding, and the rules (ACCESS.md section 9).
// Where it fits: an API calls approvalRoutes(app, { contextOf, service }) once from app.ts (nothing registers itself); the business panel's Approvals page
// and Settings → Approvals call them under /v1. The business API wires it in business/backend/src/app.ts.
// How it works:
//   GET  /approvals?status=pending|decided|all     the inbox: my requests and the ones I could decide, with `canDecide` / `canCancel` on each row
//   POST /approvals/:id/approve  { note? }         a different person approves; the action then runs as the one who asked
//   POST /approvals/:id/reject   { note? }
//   POST /approvals/:id/cancel                     only the person who asked
//   GET  /approvals/rules                          every approvable action of the apps the business has, with the rule in force
//   PUT  /approvals/rules  { action, enabled, thresholdRupees?, approverPermission?, expiresHours? }
// Rules: no logic here; the service decides. In Phase 1 every rule is off, so the inbox is empty and says so (`rulesOn: false`).

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { badRequest } from "../core/errors.js";
import type { BusinessContext } from "../core/context.js";
import type { ApprovalService } from "./service.js";

export interface ApprovalRoutesOptions {
  contextOf: (req: FastifyRequest) => Promise<BusinessContext>;
  service: ApprovalService;
}

const ListQuery = z.object({ status: z.enum(["pending", "decided", "all"]).default("pending") });
const Note = z.object({ note: z.string().trim().max(300).optional() });

const idOf = (req: FastifyRequest): string => {
  const id = (req.params as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string" || id.length === 0 || id.length > 40) throw badRequest("Bad id.");
  return id;
};

export async function approvalRoutes(app: FastifyInstance, o: ApprovalRoutesOptions) {
  const { contextOf, service } = o;

  app.get("/approvals", async (req) => ({ data: await service.list(await contextOf(req), ListQuery.parse(req.query)) }));

  app.get("/approvals/rules", async (req) => {
    const ctx = await contextOf(req);
    return { data: { rules: await service.rules(ctx), canEdit: ctx.permissions.can("workspace.settings.update") && !ctx.impersonation } };
  });
  app.put("/approvals/rules", async (req) => {
    const rule = await service.setRule(await contextOf(req), req.body);
    return { message: rule.enabled ? "Approval rule saved." : "Approval rule switched off.", data: rule };
  });

  app.post("/approvals/:id/approve", async (req) => {
    const done = await service.approve(await contextOf(req), idOf(req), Note.parse(req.body ?? {}).note);
    return { message: done.message, data: { status: done.status } };
  });
  app.post("/approvals/:id/reject", async (req) => {
    const done = await service.reject(await contextOf(req), idOf(req), Note.parse(req.body ?? {}).note);
    return { message: done.message, data: { status: done.status } };
  });
  app.post("/approvals/:id/cancel", async (req) => {
    const done = await service.cancel(await contextOf(req), idOf(req));
    return { message: done.message, data: { status: done.status } };
  });
}
