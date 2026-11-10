// BaseController: turns HTTP into service calls (KERNEL.md section 8).
// Where it fits: Fastify route -> controller -> service. It builds the context, calls one service method, and shapes the answer.
// How it works: `register(app)` adds the standard routes the controller asks for (list, get, create, update, delete, restore)
// and then `routes(app)`, where an app adds its own routes. Request bodies are NOT parsed here: the service parses them with its zod
// schemas, so there is one place where input is checked.
// Rules: no business logic and no Prisma here. Routes are only live once the controller's register() is called from app.ts
// (nothing registers itself). The real context builder (login, business, branch, permissions) arrives in P1-BE-3 and is passed
// in as `contextOf`; until then a controller cannot serve requests.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest } from "./errors.js";
import type { BusinessContext } from "./context.js";
import type { BaseService } from "./service.js";
import type { BusinessEntity } from "./repository.js";

export type StandardRoute = "list" | "get" | "create" | "update" | "delete" | "restore";

export interface ControllerConfig {
  /** URL prefix, e.g. "/api/expenses". */
  basePath: string;
  /** Which of the standard routes to add. Default: all six. */
  standardRoutes?: readonly StandardRoute[];
  /** Builds the BusinessContext of a request. Added: the real builder is P1-BE-3. */
  contextOf: (req: FastifyRequest) => Promise<BusinessContext>;
  /** Status for a successful create. Default 200 (what the old routes answer); Phase 2 apps may use 201. */
  createStatus?: 200 | 201;
  /** Verb for update. Default "PATCH". Apps whose front-end uses PUT set "PUT". */
  updateMethod?: "PATCH" | "PUT";
}

const ALL: readonly StandardRoute[] = ["list", "get", "create", "update", "delete", "restore"];

export abstract class BaseController<T extends BusinessEntity, C extends object, U extends object> {
  constructor(protected readonly service: BaseService<T, C, U>, protected readonly cfg: ControllerConfig) {}

  /** Adds the standard routes, then the app's own. Called once from app.ts. */
  register(app: FastifyInstance): void {
    const want = new Set(this.cfg.standardRoutes ?? ALL);
    const base = this.cfg.basePath;

    if (want.has("list")) app.get(base, async (req) => this.ok(await this.service.list(await this.ctxOf(req), req.query)));
    if (want.has("get")) app.get(`${base}/:id`, async (req) => this.ok(await this.service.get(await this.ctxOf(req), this.idOf(req))));
    if (want.has("create")) {
      app.post(base, async (req, reply) => {
        const row = await this.service.create(await this.ctxOf(req), req.body);
        return reply.status(this.cfg.createStatus ?? 200).send(this.ok(row));
      });
    }
    if (want.has("update")) {
      const update = async (req: FastifyRequest) => this.ok(await this.service.update(await this.ctxOf(req), this.idOf(req), req.body));
      if (this.cfg.updateMethod === "PUT") app.put(`${base}/:id`, update); else app.patch(`${base}/:id`, update);
    }
    if (want.has("delete")) {
      app.delete(`${base}/:id`, async (req, reply) => {
        await this.service.remove(await this.ctxOf(req), this.idOf(req), this.versionQuery(req));
        return this.done(reply);
      });
    }
    if (want.has("restore")) app.post(`${base}/:id/restore`, async (req) => this.ok(await this.service.restore(await this.ctxOf(req), this.idOf(req))));

    this.routes(app);
  }

  /** An app adds its own routes here (confirm, reply, export…). Default: none. */
  protected routes(_app: FastifyInstance): void { /* none */ }

  protected ctxOf(req: FastifyRequest): Promise<BusinessContext> { return this.cfg.contextOf(req); }

  /** The answer is sent as it is: single rows as the row, lists as `{ rows, meta }` (the shapes the panels already read). */
  protected ok<R>(data: R): R { return data; }

  /** An empty success. */
  protected done(reply: FastifyReply): FastifyReply { return reply.status(200).send({ ok: true }); }

  protected idOf(req: FastifyRequest): string {
    const id = (req.params as { id?: unknown } | undefined)?.id;
    if (typeof id !== "string" || id.length === 0 || id.length > 40) throw badRequest("Bad id.");
    return id;
  }

  /** `?version=3` on a delete. Optional here; the service decides what happens without it. */
  protected versionQuery(req: FastifyRequest): number | undefined {
    const v = (req.query as { version?: unknown } | undefined)?.version;
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw badRequest("Bad version.");
    return n;
  }
}
