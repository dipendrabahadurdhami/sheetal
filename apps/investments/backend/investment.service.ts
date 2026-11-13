// The rules of Investments (sponsors): offerings (investment listings), investor pledges and updates emailed to investors, on the kernel since P2-W3.
// Where it fits: InvestmentController calls one method per route. Moved from business/backend/src/modules/projects/routes.ts, every rule and message unchanged.
// How it works: investors pledge against an investment listing; a pledge is marked paid or refunded; an update is posted and emailed to every investor who
// has not been refunded. Each write runs in ONE transaction with its audit line (the old strings where there was one) and its event; emails go out after.
// Rules: offering changes need all four investments.offering.*; updates need investments.update.create; everything follows the listing's branch; only a pledge
// can be marked paid, and a refunded pledge can't be refunded again. A read-only support session changes nothing.

import { z } from "zod";
import { badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseService } from "@sheetal/platform/core/service";
import { CommitmentRepository, UpdateRepository, investmentListing, investmentListings } from "./repositories.js";
import type { CommitmentRow } from "./types.js";

export const OFFERING = "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete";
const money = z.number().int().min(0).max(1e12);
const Pledge = z.object({ name: z.string().trim().min(2).max(80), email: z.union([z.email(), z.literal("")]).optional(), phone: z.string().trim().max(30).optional(), amount: money.refine((v) => v > 0) });
const Mark = z.object({ status: z.enum(["paid", "refunded"]), ref: z.string().trim().max(80).optional(), version: z.number().int().min(1).optional() });
const Post = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(10).max(5000) });
const n = (v: bigint | number | null | undefined) => (v == null ? null : Number(v));

export interface Mailer { send(m: { to: string; subject: string; text: string }): Promise<unknown> }

export class InvestmentService extends BaseService<CommitmentRow, never, Partial<CommitmentRow>> {
  readonly commitments = new CommitmentRepository();
  readonly updates = new UpdateRepository();
  constructor(private readonly x: { bus: EventBus; mailer: () => Mailer }) {
    super({
      app: "investments", resource: "commitment", repo: new CommitmentRepository(),
      permissions: { read: OFFERING, create: OFFERING, update: OFFERING, delete: OFFERING },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "investment", label: (c) => c.name },
      bus: x.bus, requireVersion: false,
    });
  }

  private need(ctx: BusinessContext, ...perms: string[]): DataScope {
    if (!perms.some((p) => ctx.permissions.can(p))) throw forbidden("Your role can't do this.");
    return "branch";
  }
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => { audit?: { action: string; target: string }; event: { name: string; payload: object } }): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      if (a.audit) await this.writeAudit(tx, a.audit.action, a.audit.target);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1);
      return r;
    });
  }

  async overview(ctx: BusinessContext) {
    const scope = this.need(ctx, OFFERING, "investments.investor.read");
    const [ls, cs, ups] = await Promise.all([investmentListings(ctx, scope), this.commitments.all(ctx, scope), this.updates.recent(ctx, scope)]);
    return ls.map((l) => {
      const mine = cs.filter((c) => c.listingId === l.id && c.status !== "refunded");
      return { id: l.id, code: l.code, title: l.title, status: l.status, target: n(l.price),
        pledged: mine.reduce((s, c) => s + Number(c.amount), 0), paid: mine.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.amount), 0),
        investors: cs.filter((c) => c.listingId === l.id).map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, amount: n(c.amount), status: c.status, paidAt: c.paidAt, ref: c.ref, version: c.version })),
        updates: ups.filter((u) => u.listingId === l.id).map((u) => ({ id: u.id, title: u.title, body: u.body, at: u.createdAt })) };
    });
  }

  async pledge(ctx: BusinessContext, listingId: number, raw: unknown) {
    const scope = this.need(ctx, OFFERING);
    const l = await investmentListing(ctx, scope, listingId);
    const b = Pledge.parse(raw);
    await this.write(ctx, (tx) => this.commitments.add(tx, { listingId: l.id, name: b.name, email: b.email || null, phone: b.phone, amount: BigInt(b.amount) }),
      (c) => ({ event: { name: "investments.commitment.pledged", payload: { id: c.id, listingId: l.id, amount: b.amount } } }));
    return { message: `${b.name}: Rs. ${b.amount.toLocaleString("en-IN")} pledged.` };
  }

  async mark(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.need(ctx, OFFERING);
    const b = Mark.parse(raw);
    const c = await this.commitments.find(ctx, id, scope);
    if (!c) throw notFound("Commitment not found.");
    if (b.status === "paid" && c.status !== "pledged") throw badRequest("Only pledges can be marked paid.");
    if (b.status === "refunded" && c.status === "refunded") throw badRequest("Already refunded.");
    await this.write(ctx, async (tx) => {
      // Taken only if it still has the status it was read with (two clicks, or two people, can't mark it twice).
      if (!(await this.commitments.transition(tx, c.id, { status: c.status, ...(b.version !== undefined ? { version: b.version } : {}) } as Partial<CommitmentRow>, { status: b.status, ref: b.ref ?? c.ref, paidAt: b.status === "paid" ? new Date() : c.paidAt } as Partial<CommitmentRow>, scope))) {
        throw badRequest(b.status === "paid" ? "Only pledges can be marked paid." : "Already refunded.");
      }
      return c;
    }, () => ({ audit: { action: `investment.${b.status}`, target: `${c.name} Rs. ${c.amount}` }, event: { name: `investments.commitment.${b.status}`, payload: { id: c.id, listingId: c.listingId, amount: Number(c.amount) } } }));
    return { message: b.status === "paid" ? "Marked as paid." : "Marked as refunded." };
  }

  async post(ctx: BusinessContext, listingId: number, raw: unknown) {
    const scope = this.need(ctx, "investments.update.create");
    const l = await investmentListing(ctx, scope, listingId);
    const b = Post.parse(raw);
    const u = await this.write(ctx, (tx) => this.updates.add(tx, { listingId: l.id, title: b.title, body: b.body }),
      (r) => ({ event: { name: "investments.update.posted", payload: { id: r.id, listingId: l.id } } }));
    const to = await this.commitments.emailsOf(ctx, l.id);
    for (const email of to) await this.x.mailer().send({ to: email, subject: `${l.title}: ${b.title}`, text: `${b.body}\n\n— ${ctx.business.name}\n\nYou get this because you invested in ${l.title} through Sheetal Property.` });
    void u;
    return { message: `Update posted and emailed to ${to.length} investor${to.length === 1 ? "" : "s"}.` };
  }
}
