// The rules of owner statements: one month's account for an owner.
// Where it fits: the controller calls these; they call the repositories. Saving and removing run in ONE transaction: the row, the audit line (the old action strings) and the event.
// How it works: the page shows, for each owner in the person's branches, the numbers worked out now (rent collected - management fee - repairs = owed to the owner) and the
// statement saved for the month, with whether it still matches. Saving works the numbers out again, so a late payment or repair needs a new save. A saved statement counts the
// fee in the agency's profit (apps/expenses reads it); removing one stops that, so removal is a real delete (see statement.repository.ts).
// Rules: statement = collected - fee - repairs; rent is the owner's money, only the fee is income; a month that has not started cannot be saved.

import { badRequest } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { RENT_EVENTS, statementPayload } from "./events.js";
import { presentStatements } from "./presenter.js";
import { baseDeps, RentalService, type RentalDeps, type Repos } from "./rental.service.js";
import { StatementBody, StatementQuery } from "./schemas.js";
import type { StatementChange, StatementCreate } from "./statement.repository.js";
import type { StatementRow } from "./types.js";

export class StatementService extends RentalService<StatementRow, StatementCreate, StatementChange> {
  constructor(x: RentalDeps, repos: Repos) {
    super(baseDeps<StatementRow, StatementCreate, StatementChange>({
      resource: "statement", repo: repos.statements, bus: x.bus,
      schemas: { create: StatementBody as never, update: StatementBody as never },   // every write goes through the actions below
      audit: { entity: "rental", label: (s) => s.month },
    }), repos, x);
  }

  /** One month for every owner in the person's branches (GET /rentals/statements?month=). */
  async month(ctx: BusinessContext, rawQuery: unknown) {
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.read);
    const q = StatementQuery.parse(rawQuery);
    const month = q.month ?? nepalDay().slice(0, 7);
    const owners = (await this.repos.owners.list(ctx, scope)).rows;
    const [lines, saved] = await Promise.all([this.repos.statements.numbersFor(ctx, owners, month), this.repos.statements.savedFor(ctx, scope, owners.map((o) => o.id), month)]);
    return presentStatements({ month, canManage: ctx.permissions.can(this.deps.permissions.update), owners, lines, saved });
  }

  /** Save (or save again) the statement of an owner for a month. */
  save(ctx: BusinessContext, raw: unknown): Promise<{ statement: StatementRow; fee: number }> {
    let label = "";
    let fee = 0;
    return this.action<StatementRow>(ctx, {
      name: "save", permission: this.deps.permissions.create,
      audit: () => ({ action: "rental.statement_saved", target: label }),
      event: (s) => ({ name: RENT_EVENTS.statementSaved, payload: statementPayload(s) }),
      run: async (tx, scope) => {
        const b = this.parse(StatementBody, raw);
        if (b.month > nepalDay().slice(0, 7)) throw badRequest("That month hasn't started yet.");
        const o = await this.repos.owners.get(tx, b.ownerId, scope);
        const s = (await this.repos.statements.numbersFor(tx, [o], b.month)).get(o.id)!;
        fee = s.fee;
        label = `${o.name} ${b.month}: fee Rs. ${s.fee}, owed Rs. ${s.payable}`;
        return this.repos.statements.saveFor(tx, o, b.month, { collected: s.collected, fee: s.fee, repairs: s.repairs, payable: s.payable });
      },
    }).then((statement) => ({ statement, fee }));
  }

  /** Remove a saved statement: its fee no longer counts in profit. */
  discard(ctx: BusinessContext, id: string, version?: number): Promise<void> {
    return this.action<StatementRow>(ctx, {
      name: "discard", permission: this.deps.permissions.delete,
      audit: (s) => ({ action: "rental.statement_removed", target: `${s.month}` }),
      event: (s) => ({ name: RENT_EVENTS.statementDeleted, payload: statementPayload(s) }),
      run: async (tx, scope) => {
        const s = await this.repos.statements.get(tx, id, scope);
        this.sameVersion(s, version, "This statement");
        await this.repos.statements.remove(tx, s.id, scope);
        return s;
      },
    }).then(() => undefined);
  }
}
