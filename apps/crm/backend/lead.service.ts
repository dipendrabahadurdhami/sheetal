// The rules of the Inbox: enquiries (website forms, chat channels, the lead finder) as leads with stages, owners, follow-ups and replies, on the kernel.
// Moved from business/backend/src/modules/leads/routes.ts (P2-W5); every rule and message unchanged.
// Where it fits: LeadController calls one method per route.
// How it works: a lead belongs to its listing's branch (or where it came in); a reply goes out by email, or on the chat channel it came from, signed with the
// business's own contact details, and is saved in the same transaction that marks the lead contacted. Each change writes its event (and its audit line where
// the old code wrote one) in the same transaction.
// Rules: people who can assign leads (and owners) see all of them; others see their own AND unassigned ones; everyone only sees the branches in view; a lead
// can only be given to someone who works at its branch; someone who can't assign may only take a lead or let it go.

import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BranchEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import type { Vault } from "@sheetal/platform/auth/vault";
import { sendMetaText } from "@sheetal/backend-core/lib/meta";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import { worksAt } from "@sheetal/backend-core/domain/branches";
import { LeadRepository } from "./lead.repository.js";

export const STAGES = ["new", "contacted", "viewing", "negotiating", "won", "lost"] as const;
const time = (d: Date) => d.toISOString();
const Edit = z.object({
  stage: z.enum(STAGES).optional(), assignee: z.string().max(40).nullable().optional(), follow: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(), value: z.coerce.number().min(0).max(1e13).nullable().optional(), read: z.literal(true).optional(),
  version: z.number().int().min(1).optional(),
});

export interface Mailer { send(m: { to: string; subject: string; text: string }): Promise<unknown> }
type L = BranchEntity;
class LeadBase extends BaseRepository<L, never, never> {
  constructor() { super({ model: "lead", ownerField: null, label: "This lead", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
}

export class LeadService extends BaseService<L, never, never> {
  readonly leads = new LeadRepository();
  constructor(private readonly x: { bus: EventBus; vault: Vault; mailer: () => Mailer; fetch?: Fetch }) {
    super({ app: "crm", resource: "lead", repo: new LeadBase(), permissions: { read: "crm.lead.read", create: "crm.lead.read", update: "crm.lead.read", delete: "crm.lead.assign" },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "lead", label: (l) => l.id }, bus: x.bus, requireVersion: false });
  }

  /** May this person see leads, and do they see all of them (assigners and owners) or only theirs and unassigned ones? */
  private access(ctx: BusinessContext): { all: boolean } {
    if (!ctx.permissions.can("crm.lead.read") && !ctx.permissions.can("crm.message.reply")) throw forbidden("Your role can't see leads.");
    return { all: ctx.permissions.can("crm.lead.assign") || ctx.member.roleKey === "owner" };
  }
  private async one(ctx: BusinessContext, all: boolean, id: string) {
    const l = await this.leads.one(ctx, all, id);
    if (!l) throw notFound("Lead not found.");
    return l;
  }
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => { audit?: { action: string; target: string }; event: { name: string; payload: object; branchId?: string | null } }): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      if (a.audit) await this.writeAudit(tx, a.audit.action, a.audit.target);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1, { branchId: a.event.branchId ?? null });
      return r;
    });
  }

  async inbox(ctx: BusinessContext, rawQuery: unknown) {
    const { all } = this.access(ctx);
    const q = z.object({ stage: z.enum(STAGES).optional(), take: z.coerce.number().int().min(1).max(500).default(200) }).parse(rawQuery);
    const leads = await this.leads.list(ctx, all, q.stage, q.take);
    const byId = new Map((await this.leads.listings(ctx, leads.map((l) => l.listingId).filter((x): x is number => x != null))).map((l) => [l.id, l]));
    const names = new Map((await this.leads.userNames(ctx, leads.map((l) => l.assigneeId).filter((x): x is string => !!x))).map((u) => [u.id, u.userName]));
    return leads.map((l) => {
      const listing = l.listingId ? byId.get(l.listingId) : undefined;
      const msgs = [["in", l.message || "(no message)", time(l.createdAt)], ...l.messages.map((m) => [m.direction, m.body, time(m.createdAt)])];
      return {
        id: l.id, channel: ((l.details as { channel?: string } | null)?.channel) ?? "website", kind: l.kind, name: l.name, email: l.email, phone: l.phone,
        stage: l.status, assignee: l.assigneeId, assigneeName: l.assigneeId ? names.get(l.assigneeId) ?? null : null,
        follow: l.followAt ? l.followAt.toISOString().slice(0, 10) : null, tags: l.tags,
        value: l.value != null ? Number(l.value) : listing?.price != null ? Number(listing.price) : null,
        listing: listing?.code ?? null, listingTitle: listing?.title ?? null, details: l.details, branchId: l.branchId, branch: l.branch?.name ?? null,
        last: msgs[msgs.length - 1]![1], at: time(l.lastAt), unread: !l.readAt || l.readAt < l.lastAt ? 1 : 0, msgs, version: l.version,
      };
    });
  }

  async edit(ctx: BusinessContext, id: string, raw: unknown) {
    const { all } = this.access(ctx);
    const l = await this.one(ctx, all, id);
    const { version, ...b } = Edit.parse(raw);
    if (b.assignee !== undefined) {
      if (!all && b.assignee !== ctx.member.userId && b.assignee !== null) throw forbidden("Your role can't hand leads to others.");
      if (b.assignee) {
        // Only to someone in the team who works at the lead's branch.
        const [m, br] = await Promise.all([this.leads.member(ctx, b.assignee), l.branchId ? this.leads.branchName(ctx, l.branchId) : null]);
        if (!m) throw badRequest("Pick someone in your team.");
        if (!worksAt(m, l.branchId, br?.name)) throw badRequest(`They don't work at ${br?.name}. Give them that branch on the Team page first.`);
      }
    }
    const moved = !!b.stage && b.stage !== l.status;
    await this.write(ctx, async (tx) => {
      const ok = await this.leads.change(tx, l.id, {
        status: b.stage, assigneeId: b.assignee, tags: b.tags,
        followAt: b.follow === undefined ? undefined : b.follow ? new Date(`${b.follow}T09:00:00+05:45`) : null,
        value: b.value === undefined ? undefined : b.value == null ? null : BigInt(Math.round(b.value)),
        readAt: b.read ? new Date() : undefined,
      }, version);
      if (!ok) throw conflict("Someone else changed this lead. Reload to see the latest.");
      return l;
    }, () => ({ ...(moved ? { audit: { action: "lead.stage", target: `${l.name}: ${b.stage}` } } : {}), event: { name: moved ? "crm.lead.stage_changed" : "crm.lead.updated", payload: { id: l.id, stage: b.stage ?? l.status, assigneeId: b.assignee === undefined ? l.assigneeId : b.assignee }, branchId: l.branchId } }));
    return { message: b.read ? undefined : "Saved." };
  }

  async reply(ctx: BusinessContext, id: string, raw: unknown) {
    if (!ctx.permissions.can("crm.message.reply")) throw forbidden("Your role can't reply to leads.");
    const { all } = this.access(ctx);
    const l = await this.one(ctx, all, id);
    const { text } = z.object({ text: z.string().trim().min(1, "Write a reply.").max(5000) }).parse(raw);
    // A chat from WhatsApp, Messenger or Instagram is answered there; everything else by email.
    const d = (l.details ?? {}) as { channel?: string; account?: string; contact?: string };
    const chat = d.account && d.contact && ["whatsapp", "messenger", "instagram"].includes(d.channel ?? "") ? await this.leads.chatAccount(ctx, d.account) : null;
    if (!chat && !l.email) throw badRequest(`${l.name} left a phone number only${l.phone ? ` (${l.phone})` : ""}. Call or WhatsApp them instead.`);
    const now = new Date();
    await this.write(ctx, async (tx) => {
      await this.leads.addMessage(tx, l.id, text);
      await this.leads.change(tx, l.id, { lastAt: now, readAt: now, status: l.status === "new" ? "contacted" : undefined, assigneeId: l.assigneeId ?? tx.member.userId });
      return l;
    }, () => ({ event: { name: "crm.lead.replied", payload: { id: l.id, channel: chat ? d.channel : "email" }, branchId: l.branchId } }));
    if (chat) {
      try { await sendMetaText({ channel: d.channel!, accountId: chat.externalId, token: this.x.vault.open(chat.accessToken), to: d.contact!, text, fetch: this.x.fetch }); }
      catch (e) { throw badRequest(`${d.channel} didn't take the message: ${e instanceof Error ? e.message : "failed"}. It's saved here; try again.`); }
      return { message: `Sent on ${d.channel === "whatsapp" ? "WhatsApp" : d.channel === "instagram" ? "Instagram" : "Messenger"}.` };
    }
    const [t, me] = await Promise.all([this.leads.business(ctx), this.leads.me(ctx)]);
    await this.x.mailer().send({
      to: l.email!, subject: `Re: your enquiry with ${t.name}`,
      text: `${text}\n\n— ${me?.userName ?? ""}, ${t.name}${t.phone ? ` · ${t.phone}` : ""}${t.email ? `\nTo answer, write to ${t.email}.` : ""}\n\nYou wrote:\n${l.message}`,
    });
    return { message: `Sent to ${l.email}.` };
  }
}
