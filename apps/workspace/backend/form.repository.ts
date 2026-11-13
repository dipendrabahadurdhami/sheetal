// The only code of online forms (Business → Forms) that reads and writes tables (KERNEL.md section 6). Moved out of
// business/backend/src/modules/forms/routes.ts in P2-W6 (Workspace part 2). The public side (showing a live form, taking answers) stays in
// website/backend/src/modules/forms.
// Where it fits: FormService calls these, in its transaction for a change.
// How it works: plain Prisma calls on the context's transaction (or the client when reading). A form belongs to a branch; `inView` is the branch filter
// the service worked out from the branches in view. Forms carry the kernel columns `version` and `updated_by` (migration
// 20261113180000_forms_kernel_columns).
// Rules: every query carries this business. One agreed cross-app write (MODEL-OWNERS.md): confirming a form payment sets the value of the Inbox lead the
// response made, in the same transaction.

import type { Prisma } from "@prisma/client";
import { actorIdOf, type BusinessContext } from "@sheetal/platform/core/context";
import { formLimits, monthStart } from "@sheetal/backend-core/domain/forms";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
export type InView = { branchId?: { in: string[] } };

export class FormRepository {
  forms(ctx: BusinessContext, inView: InView) { return db(ctx).form.findMany({ where: { tenantId: ctx.business.id, ...inView }, orderBy: { createdAt: "desc" } }); }
  responseCounts(ctx: BusinessContext) { return db(ctx).formResponse.groupBy({ by: ["formId"], where: { tenantId: ctx.business.id }, _count: true }); }
  team(ctx: BusinessContext) { return db(ctx).membership.findMany({ where: { tenantId: ctx.business.id, status: "active" }, select: { userId: true, user: { select: { userName: true } } } }); }
  async limits(ctx: BusinessContext) {
    const t = ctx.business.id;
    const [lim, forms, month] = await Promise.all([formLimits(db(ctx), t), db(ctx).form.count({ where: { tenantId: t } }), db(ctx).formResponse.count({ where: { tenantId: t, createdAt: { gte: monthStart() } } })]);
    return { ...lim, used: forms, monthResponses: month };
  }
  one(ctx: BusinessContext, inView: InView, id: string) { return db(ctx).form.findFirst({ where: { tenantId: ctx.business.id, ...inView, id } }); }
  /** Slugs are unique across Sheetal (the public link), so this one looks at every business. */
  slugOwner(ctx: BusinessContext, slug: string) { return db(ctx).form.findUnique({ where: { slug }, select: { id: true } }); }
  userName(ctx: BusinessContext, id: string) { return db(ctx).user.findUnique({ where: { id }, select: { id: true, userName: true } }); }
  /** A team member of this business, with role and branch links (to check who may get a form's leads). */
  member(ctx: BusinessContext, userId: string) {
    return db(ctx).membership.findFirst({ where: { tenantId: ctx.business.id, userId, status: "active" }, include: { role: true, branches: { select: { branchId: true } } } });
  }
  branchName(ctx: BusinessContext, id: string) { return db(ctx).branch.findFirst({ where: { id, tenantId: ctx.business.id }, select: { name: true } }); }

  create(ctx: BusinessContext, data: Omit<Prisma.FormUncheckedCreateInput, "tenantId" | "createdBy" | "updatedBy">) {
    const me = actorIdOf(ctx);
    return db(ctx).form.create({ data: { ...data, tenantId: ctx.business.id, createdBy: me, updatedBy: me } });
  }
  /** Changes a form of this business; with `version`, only if nobody changed it since (false = someone did, or it is gone). */
  async change(ctx: BusinessContext, id: string, data: Prisma.FormUncheckedUpdateManyInput, version?: number): Promise<boolean> {
    const n = await db(ctx).form.updateMany({ where: { id, tenantId: ctx.business.id, ...(version !== undefined ? { version } : {}) }, data: { ...data, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } });
    return n.count > 0;
  }
  /** Removes a form and its responses (by cascade); the Inbox leads they made stay. */
  remove(ctx: BusinessContext, id: string) { return db(ctx).form.deleteMany({ where: { id, tenantId: ctx.business.id } }); }

  // ───── Responses ─────
  formsFor(ctx: BusinessContext, inView: InView, q: { formId?: string; dest: string }) {
    return db(ctx).form.findMany({ where: { tenantId: ctx.business.id, ...inView, ...(q.formId ? { id: q.formId } : {}), ...(q.dest !== "all" ? { dest: q.dest } : {}) }, select: { id: true, title: true, dest: true, fields: true } });
  }
  responses(ctx: BusinessContext, formIds: string[], take: number) {
    return db(ctx).formResponse.findMany({ where: { tenantId: ctx.business.id, formId: { in: formIds } }, orderBy: { createdAt: "desc" }, take });
  }
  response(ctx: BusinessContext, inView: InView, id: string) { return db(ctx).formResponse.findFirst({ where: { id, tenantId: ctx.business.id, form: { tenantId: ctx.business.id, ...inView } } }); }
  setPayment(ctx: BusinessContext, id: string, payStatus: string) { return db(ctx).formResponse.updateMany({ where: { id, tenantId: ctx.business.id }, data: { payStatus } }); }
  /** The agreed cross-app write: a confirmed payment becomes the value of the lead the response made. */
  leadValue(ctx: BusinessContext, leadId: number, value: bigint) { return db(ctx).lead.updateMany({ where: { id: leadId, tenantId: ctx.business.id }, data: { value } }); }
}
