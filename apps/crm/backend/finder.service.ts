// The AI lead finder (Inbox → Find leads) and incoming chat messages (WhatsApp, Messenger, Instagram through Meta's webhook), on the kernel. Moved from
// business/backend/src/modules/growth/routes.ts in P2-W6; every rule, message and status code unchanged.
// Where it fits: FinderController (the lead finder, POST /ai/extract-leads) and the Meta webhook (GET/POST /webhooks/meta, registered by leadRoutes).
// How it works: the lead finder reads pasted text with AI (counted against monthly credits by backend-core's extractLeads, which talks to the AI first,
// outside any transaction); with "save", the leads go into the branch open in the panel in ONE transaction with an audit line and an event. A webhook
// message from a connected channel joins the open lead of that contact, or starts a new lead at the business's head office; each one is written with
// its event in one transaction, and the people who get leads are told after.
// Rules: the lead finder needs a role that sees leads or replies, and the plan's AI feature; webhooks are only trusted with a valid signature (checked
// by the controller before anything is read).

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { AppError, forbidden } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import type { Vault } from "@sheetal/platform/auth/vault";
import { leadPeople, notify } from "@sheetal/platform/notify/index";
import { aiFor, extractLeads, type AiClient } from "@sheetal/backend-core/lib/ai";
import { requireAiFeature } from "@sheetal/backend-core/domain/ai-features";
import { readMetaWebhook } from "@sheetal/backend-core/lib/meta";
import { headOffice } from "@sheetal/backend-core/domain/branches";
import { FinderRepository } from "./finder.repository.js";

type Tx = Prisma.TransactionClient;
export type Ai = { client: AiClient; model: string; credits: Record<string, number>; own?: boolean; cap?: number };
export interface FinderDeps { bus: EventBus; db: unknown; vault: Vault; ai?: Ai; log?: FastifyBaseLogger }
const dbOf = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;

export class FinderService {
  readonly repo = new FinderRepository();
  constructor(private readonly x: FinderDeps) {}
  private get db() { return this.x.db as Tx; }
  /** The business's own AI key when it saved one, else Sheetal's. */
  ai(tenantId: string) { return this.x.ai ? Promise.resolve(this.x.ai) : aiFor(this.db as never, this.x.vault, tenantId); }

  async extract(ctx: BusinessContext, raw: unknown) {
    if (!["crm.lead.read", "crm.message.reply"].some((p) => ctx.permissions.can(p))) throw forbidden("Your role can't do this.");
    const b = z.object({ text: z.string().trim().min(20, "Paste a bit more text.").max(60_000, "That's too long; paste up to about 10 pages at a time."), save: z.boolean().default(false) }).parse(raw);
    if (b.save && ctx.impersonation?.readOnly) throw forbidden("This is a read-only support session. Changes are not allowed.");
    const plan = await this.repo.planOf(dbOf(ctx), ctx.business.id);
    await requireAiFeature(this.db as never, plan.name, "lead_finder");
    const a = await this.ai(ctx.business.id);
    if (!a) throw new AppError(503, "ai_off", "AI isn't switched on yet. Sheetal is setting it up.");
    const r = await extractLeads(this.db as never, a, { text: b.text, tenantId: ctx.business.id, planName: plan.name, userId: ctx.member.userId });
    let saved = 0;
    if (b.save) {
      // Into the branch open in the panel (or the person's only branch).
      const branchId = ctx.branches.branchForNew();
      saved = await ctx.transaction(async (tx) => {
        for (const l of r.leads) {
          await this.repo.addLead(dbOf(tx), { tenantId: ctx.business.id, branchId, kind: "chat", name: l.name || l.phone || l.email, phone: l.phone || null, email: l.email || null, message: [l.need, l.budget && `Budget: ${l.budget}`, l.location && `Area: ${l.location}`, l.note].filter(Boolean).join(" · "), details: { channel: "web", source: "ai_found", budget: l.budget, location: l.location } });
        }
        await this.repo.audit(dbOf(tx), { tenantId: ctx.business.id, actorId: ctx.actor.kind === "user" ? ctx.actor.userId : null, action: "leads.found", target: String(r.leads.length), ip: ctx.ip });
        await this.x.bus.publish(tx, "crm.lead.found", { count: r.leads.length }, 1, { branchId });
        return r.leads.length;
      });
    }
    return { message: b.save ? `${saved} lead${saved === 1 ? "" : "s"} added to the Inbox.` : `Found ${r.leads.length} lead${r.leads.length === 1 ? "" : "s"}.`, data: r };
  }

  /** Meta's verify token and app secret (Admin → Integrations), opened from the vault. */
  async metaKeys() {
    const v = ((await this.repo.metaSetting(this.db))?.value ?? {}) as { appSecret?: string; verifyToken?: string };
    const open = (s?: string) => { try { return s ? this.x.vault.open(s) : null; } catch { return null; } };
    return { appSecret: open(v.appSecret), verifyToken: open(v.verifyToken) };
  }

  /** Messages from Meta's webhook (signature already checked): each joins its contact's open lead, or starts one. */
  async received(body: unknown, info: { requestId: string; ip: string; log: FastifyBaseLogger }) {
    for (const msg of readMetaWebhook(body)) {
      const acct = await this.repo.channel(this.db, msg.accountId);
      if (!acct?.active) continue;
      const key = `${msg.channel}:${msg.from}`;
      const ctxFor = (tx: Tx) => ({ requestId: info.requestId, ip: info.ip, now: new Date(), log: info.log, db: this.db, tx, actor: { kind: "system", job: "meta.webhook" }, business: { id: acct.tenantId } }) as never;
      const lead = await this.repo.openLead(this.db, acct.tenantId, key);
      if (lead) {
        // Meta can send the same message twice; skip what's already there.
        const first = lead.message === msg.text && lead.createdAt.getTime() === msg.at.getTime();
        if (!first && !(await this.repo.sameMessage(this.db, lead.id, msg.text, msg.at))) {
          await (this.db as unknown as { $transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> }).$transaction(async (tx) => {
            await this.repo.addMessage(tx, lead.id, msg.text, msg.at);
            await this.x.bus.publish(ctxFor(tx), "crm.lead.received", { id: lead.id, channel: msg.channel }, 1, { branchId: lead.branchId });
          });
        }
      } else {
        const branchId = await headOffice(this.db as never, acct.tenantId);
        await (this.db as unknown as { $transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> }).$transaction(async (tx) => {
          const l = await this.repo.addLead(tx, { tenantId: acct.tenantId, branchId, kind: "chat", name: msg.name || "New contact", phone: msg.channel === "whatsapp" ? `+${msg.from}` : null, message: msg.text, contactKey: key, details: { channel: msg.channel, account: acct.externalId, contact: msg.from }, createdAt: msg.at, lastAt: msg.at });
          await this.x.bus.publish(ctxFor(tx), "crm.lead.received", { id: l.id, channel: msg.channel }, 1, { branchId });
        });
        await notify(this.db as never, await leadPeople(this.db as never, acct.tenantId, branchId), { tenantId: acct.tenantId, type: "lead", title: `New ${msg.channel} message from ${msg.name || "someone"}`, message: msg.text.slice(0, 140), link: "/business/inbox" });
      }
    }
  }
}
