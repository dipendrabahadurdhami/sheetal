// The Workspace's growth tools on the kernel: AI credits used this month, analytics for the branches in view, and connecting chat channels (WhatsApp,
// Messenger, Instagram). Moved from business/backend/src/modules/growth/routes.ts in P2-W6; every rule, message and status code unchanged. The lead
// finder and Meta's webhook moved to the CRM app, the calendar feeds to the Hotel app.
// Where it fits: GrowthController (the panel's Analytics and Channels pages, the AI meter).
// How it works: analytics count real visitors (bots excluded when they were saved) of the business's listings; for one branch (or staff limited to
// some) only that branch's listings and leads. A channel's access token is sealed with SECRETS_KEY and never sent back. Connecting and disconnecting
// write their audit line and event in ONE transaction.
// Rules: analytics need a role that sees the overview, listings or leads; channels are set up by people who manage the business settings and seen by
// those and people who reply to messages.

import { z } from "zod";
import { badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BusinessEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import type { Vault } from "@sheetal/platform/auth/vault";
import { aiFor, creditsUsed, type AiClient } from "@sheetal/backend-core/lib/ai";
import { GrowthRepository } from "./growth.repository.js";
import { SETTINGS_PERM } from "./workspace.service.js";

type Ai = { client: AiClient; model: string; credits: Record<string, number>; own?: boolean; cap?: number };
class GrowthBase extends BaseRepository<BusinessEntity, never, never> {
  constructor() { super({ model: "channelAccount", branchField: null, ownerField: null, label: "This channel", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "asc" }] }); }
}
export interface GrowthDeps { bus: EventBus; db: unknown; vault: Vault; ai?: Ai }

export class GrowthService extends BaseService<BusinessEntity, never, never> {
  readonly growth = new GrowthRepository();
  constructor(private readonly x: GrowthDeps) {
    super({ app: "workspace", resource: "channel", repo: new GrowthBase(), permissions: { read: SETTINGS_PERM, create: SETTINGS_PERM, update: SETTINGS_PERM, delete: SETTINGS_PERM },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "channel", label: (c) => c.id }, bus: x.bus, requireVersion: false });
  }
  private need(ctx: BusinessContext, ...perms: string[]) { if (!perms.some((p) => ctx.permissions.can(p))) throw forbidden("Your role can't do this."); }

  async aiUsage(ctx: BusinessContext) {
    const a = this.x.ai ?? (await aiFor(this.x.db as never, this.x.vault, ctx.business.id));
    const plan = await this.growth.planOf(ctx);
    const limit = a?.own ? (a.cap || -1) : (a?.credits[plan.name] ?? 0);
    return { enabled: !!a, own: !!a?.own, used: await creditsUsed(this.x.db as never, ctx.business.id, new Date(), !!a?.own), limit };
  }

  async analytics(ctx: BusinessContext, rawQuery: unknown) {
    this.need(ctx, "workspace.overview.read", "listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "crm.lead.read");
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }).parse(rawQuery);
    const since = new Date(Date.now() - days * 864e5);
    // For one branch (or staff limited to some): views of that branch's listings and its leads only.
    const branchIds = ctx.branches.idsFor("branch");
    const ids = branchIds ? await this.growth.listingIdsInView(ctx, branchIds) : null;
    const [views, visitors, byListing, leads, byDay] = await this.growth.analytics(ctx, since, ids, branchIds);
    const titles = new Map((await this.growth.listingTitles(ctx, byListing.map((b) => b.listingId!).filter(Boolean))).map((l) => [l.id, l]));
    const leadsBy = new Map(leads.map((l) => [l.listingId, l._count]));
    return {
      days, views, visitors, leads: leads.reduce((s, l) => s + l._count, 0), byDay,
      topListings: byListing.map((b) => ({ ...titles.get(b.listingId!), views: b._count, leads: leadsBy.get(b.listingId) ?? 0 })),
    };
  }

  async channels(ctx: BusinessContext) {
    this.need(ctx, SETTINGS_PERM, "crm.message.reply");
    return (await this.growth.channels(ctx)).map(({ accessToken: _t, ...r }) => r);
  }
  async connect(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.need(ctx, SETTINGS_PERM);
    const b = z.object({ kind: z.enum(["whatsapp", "messenger", "instagram"]), externalId: z.string().trim().regex(/^\d{5,30}$/, "Use the numeric id from Meta."), name: z.string().trim().min(2).max(80), accessToken: z.string().trim().min(20).max(1000) }).parse(raw);
    if (await this.growth.channelByExternalId(ctx, b.externalId)) throw badRequest("That account is already connected.");
    await this.inTransaction(ctx, async (tx) => {
      const c = await this.growth.addChannel(tx, { kind: b.kind, externalId: b.externalId, name: b.name, accessToken: this.x.vault.seal(b.accessToken) });
      await this.writeAudit(tx, "channel.connected", `${b.kind} ${b.name}`);
      await this.deps.bus.publish(tx, "workspace.channel.connected", { id: c.id, kind: b.kind }, 1);
    });
    return { message: `${b.name} connected. New messages arrive in the Inbox.` };
  }
  async disconnect(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    this.need(ctx, SETTINGS_PERM);
    await this.inTransaction(ctx, async (tx) => {
      if (!(await this.growth.removeChannel(tx, id))) throw notFound("Channel not found.");
      await this.writeAudit(tx, "channel.disconnected", id);
      await this.deps.bus.publish(tx, "workspace.channel.disconnected", { id }, 1);
    });
    return { message: "Disconnected." };
  }
}
