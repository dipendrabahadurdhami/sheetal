// The shared part of the seven Rentals repositories: custom "not found" text, guarded updates and the rare real delete.
// Where it fits: owner / unit / lease / bill / payment / repair / statement repositories extend this class; services never touch Prisma directly.
// How it works: it is a BaseRepository (every query limited to the business, hides deleted rows, follows the branch scope) plus three helpers for the few writes
// the base class cannot express: `guardedUpdate` (change a row only if it still looks a certain way, by any Prisma filter, e.g. "paid is still 0"), `deleteRow`
// (a real delete, see the rule below) and `raw` (the table's Prisma delegate, for the named queries of the subclasses).
// Rules: a missing or out-of-scope row answers with the old text ("Owner not found."), never telling which. Payments and statements are removed with a soft delete
// (`softDeleteRow`) since P2-W6, when every other reader (profit, the website and admin rent pages, online-payment decisions) learned to skip deleted rows.
// Owners and units keep a real delete (`deleteRow`): their branch link is ON DELETE RESTRICT, so a hidden row would block removing the branch.

import type { BusinessContext, DataScope, Tx } from "@sheetal/platform/core/context";
import { actorIdOf } from "@sheetal/platform/core/context";
import { notFound } from "@sheetal/platform/core/errors";
import { BaseRepository, type BranchEntity, type RepositoryConfig } from "@sheetal/platform/core/repository";
import type { Db } from "@sheetal/platform/db/client";

/** The few Prisma delegate methods the named queries use. Delegates are looked up by model name, as the base class does. */
export interface RawDelegate {
  findFirst(a: { where: object; select?: object }): Promise<unknown>;
  findMany(a: { where: object; select?: object; orderBy?: object; take?: number }): Promise<unknown[]>;
  count(a: { where: object }): Promise<number>;
  createMany(a: { data: object[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
  updateMany(a: { where: object; data: object }): Promise<{ count: number }>;
  deleteMany(a: { where: object }): Promise<{ count: number }>;
  upsert(a: { where: object; create: object; update: object }): Promise<unknown>;
}
export const rawOf = (db: Db | Tx, model: string): RawDelegate => (db as unknown as Record<string, RawDelegate>)[model]!;

export abstract class RentalRepository<T extends BranchEntity, C extends object, U extends object> extends BaseRepository<T, C, U> {
  constructor(cfg: RepositoryConfig<T>, private readonly missing: string) { super(cfg); }

  /** An id longer than 40 characters is cut, so it is "not found" (404) as before, not a 400. */
  override async get(ctx: BusinessContext, id: string, scope: DataScope, opts: { includeDeleted?: boolean } = {}): Promise<T> {
    const row = await this.find(ctx, id.slice(0, 40), scope, opts);
    if (!row) throw notFound(this.missing);
    return row;
  }

  protected raw(ctx: BusinessContext): RawDelegate { return rawOf(ctx.tx ?? ctx.db, this.cfg.model); }

  /** Compare-and-set with any Prisma filter: the row changes only if it is in scope AND still matches `guard`. Bumps the version. Returns whether it changed. */
  protected async guardedUpdate(ctx: BusinessContext, id: string, scope: DataScope, guard: object, data: object): Promise<boolean> {
    const where = { AND: [await this.scopeWhere(ctx, scope), { id }, guard] };
    const { count } = await this.raw(ctx).updateMany({ where, data: { ...data, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } });
    return count > 0;
  }

  /** A soft delete of one row in scope (deletedAt and deletedBy set, version bumped); a missing, deleted or out-of-scope row is "not found" with this table's text. */
  protected async softDeleteRow(ctx: BusinessContext, id: string, scope: DataScope): Promise<void> {
    const where = { AND: [await this.scopeWhere(ctx, scope), { id }] };
    const me = actorIdOf(ctx);
    const { count } = await this.raw(ctx).updateMany({ where, data: { deletedAt: ctx.now, deletedBy: me, updatedBy: me, version: { increment: 1 } } });
    if (!count) throw notFound(this.missing);
  }

  /** A real delete of one row in scope. Only subclasses with a reason call it (the reason is in their header). */
  protected async deleteRow(ctx: BusinessContext, id: string, scope: DataScope): Promise<void> {
    const where = { AND: [await this.scopeWhere(ctx, scope), { id }] };
    const { count } = await this.raw(ctx).deleteMany({ where });
    if (!count) throw notFound(this.missing);
  }
}
