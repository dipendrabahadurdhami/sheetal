// The HTTP side of Expenses: the routes, exactly as the page calls them (KERNEL.md 10.4).
// Where it fits: expenseRoutes() (routes.ts) registers these two controllers; each handler builds the context, calls ONE service method and shapes the answer.
// How it works: ExpenseController serves /expenses (list, add, change, confirm, delete, receipt, profit); RecurringController serves /expenses/recurring.
// Every path, verb and answer is the old one: change is PUT, create answers 200, answers look like { message, data } and the list like { data: { rows, … } }.
// P1-BE-7: the list answers `meta.can` (per-action flags) when a page is asked for or with ?flags=1; without either the answer is the old one.
// Rules: no business logic and no Prisma here. The standard routes of BaseController are switched off (standardRoutes: []) because the answers have their own
// shape; the routes below are the whole API of the app. A route does nothing until app.ts registers expenseRoutes (it does, with { prefix: "/v1" }).

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { present, presentRecurring } from "./presenter.js";
import { ExpenseService, RecurringExpenseService, type RecurringAction } from "./expense.service.js";
import type { ExpenseChange, ExpenseCreate, RecurringChange, RecurringCreate } from "./schemas.js";
import type { ExpenseRow, RecurringExpenseRow } from "./types.js";
import { expenseNo } from "./categories.js";

type ContextOf = (req: FastifyRequest) => Promise<BusinessContext>;
const namesOf = (ctx: BusinessContext) => new Map(ctx.branches.mine.map((b) => [b.id, b.name]));
type IdParams = { Params: { id: string } };

export class ExpenseController extends BaseController<ExpenseRow, ExpenseCreate, ExpenseChange> {
  constructor(private readonly expenses: ExpenseService, contextOf: ContextOf) {
    super(expenses, { basePath: "/expenses", standardRoutes: [], contextOf, createStatus: 200, updateMethod: "PUT" });
  }

  /** An id longer than 40 characters is cut, so it is "not found" (404) as before, not a 400. */
  protected override idOf(req: FastifyRequest): string { return ((req.params as { id?: string }).id ?? "").slice(0, 40); }

  protected override routes(app: FastifyInstance): void {
    const base = this.cfg.basePath;

    app.get(base, async (req) => {
      const { meta, can, ...data } = await this.expenses.overview(await this.ctxOf(req), req.query);
      // `meta` only when the caller asked for a page (page/per) or for the flags (?flags=1): the old call's answer is unchanged. `meta.can` says what the person may do.
      const flags = (req.query as { flags?: unknown } | undefined)?.flags === "1";
      return meta || flags ? { data, meta: { ...(meta ?? {}), can } } : { data };
    });
    app.post(base, async (req) => {
      const ctx = await this.ctxOf(req);
      const e = await this.expenses.create(ctx, req.body);
      return { message: `${expenseNo(e.seq)} saved.`, data: present(e, namesOf(ctx)) };
    });
    app.put<IdParams>(`${base}/:id`, async (req) => {
      const ctx = await this.ctxOf(req);
      const e = await this.expenses.update(ctx, this.idOf(req), req.body);
      return { message: `${expenseNo(e.seq)} saved.`, data: present(e, namesOf(ctx)) };
    });
    app.post<IdParams>(`${base}/:id/confirm`, async (req) => {
      const ctx = await this.ctxOf(req);
      const e = await this.expenses.confirm(ctx, this.idOf(req), req.body);
      return { message: `${expenseNo(e.seq)} confirmed.`, data: present(e, namesOf(ctx)) };
    });
    app.delete<IdParams>(`${base}/:id`, async (req) => {
      const done = await this.expenses.discard(await this.ctxOf(req), this.idOf(req), this.versionQuery(req));
      return { message: done.skipped ? `${done.no} skipped.` : `${done.no} deleted.` };
    });

    // Receipt: a photo or PDF, kept private.
    app.post<IdParams>(`${base}/:id/receipt`, { bodyLimit: 12 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (req) => {
      await this.expenses.attachReceipt(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: "Receipt saved." };
    });
    app.get<IdParams>(`${base}/:id/receipt`, async (req) => ({ data: await this.expenses.readReceipt(await this.ctxOf(req), this.idOf(req)) }));
    app.delete<IdParams>(`${base}/:id/receipt`, async (req) => {
      await this.expenses.removeReceipt(await this.ctxOf(req), this.idOf(req));
      return { message: "Receipt removed." };
    });

    app.get(`${base}/profit`, async (req) => ({ data: await this.expenses.profit(await this.ctxOf(req), req.query) }));
  }
}

export class RecurringController extends BaseController<RecurringExpenseRow, RecurringCreate, RecurringChange> {
  constructor(private readonly recurring: RecurringExpenseService, contextOf: ContextOf) {
    super(recurring, { basePath: "/expenses/recurring", standardRoutes: [], contextOf, createStatus: 200, updateMethod: "PUT" });
  }

  protected override idOf(req: FastifyRequest): string { return ((req.params as { id?: string }).id ?? "").slice(0, 40); }

  protected override routes(app: FastifyInstance): void {
    const base = this.cfg.basePath;

    app.get(base, async (req) => {
      const ctx = await this.ctxOf(req);
      const names = namesOf(ctx);
      return { data: (await this.recurring.all(ctx)).map((r) => presentRecurring(r, names)) };
    });
    app.post(base, async (req) => {
      const ctx = await this.ctxOf(req);
      const r = await this.recurring.create(ctx, req.body);
      return { message: `Added. A draft is made on day ${r.dayOfMonth} of every month, for you to confirm.`, data: presentRecurring(r, namesOf(ctx)) };
    });
    app.put<IdParams>(`${base}/:id`, async (req) => {
      const ctx = await this.ctxOf(req);
      const r = await this.recurring.update(ctx, this.idOf(req), req.body);
      return { message: "Saved. Drafts already made keep their amount.", data: presentRecurring(r, namesOf(ctx)) };
    });
    for (const action of ["pause", "resume", "stop"] as const satisfies readonly RecurringAction[]) {
      app.post<IdParams>(`${base}/:id/${action}`, async (req) => ({ message: await this.recurring.act(await this.ctxOf(req), this.idOf(req), action, req.body) }));
    }
  }
}
