// The guided setup of a new business: which first steps are done (worked out from the real data) and whether the person has hidden the guide.
// Where it fits: SetupController serves GET /setup and POST /setup/state; the panel's "Getting started" page and the Overview card read them.
// How it works: each step is checked against the business's own rows (details, logo, first listing or room, team, email domain, verification);
// "hidden" and "tourSeen" are kept in the business's settings under "setup".
// Rules: read-only except the two flags; only people who may change settings can change them; nothing here is secret.

import type { Prisma } from "@prisma/client";
import { forbidden } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { SETTINGS_PERM } from "./workspace.service.js";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
type Flags = { hidden?: boolean; tourSeen?: boolean };

export interface SetupStep { id: string; done: boolean; optional?: boolean; to: string }

export class SetupService {
  async status(ctx: BusinessContext) {
    const t = await db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id } });
    const stays = t.type === "hotel" || t.type === "host";
    const [rooms, listings, members, invites, domains] = await Promise.all([
      stays ? db(ctx).room.count({ where: { tenantId: t.id } }) : Promise.resolve(0),
      stays ? Promise.resolve(0) : db(ctx).listing.count({ where: { tenantId: t.id } }),
      db(ctx).membership.count({ where: { tenantId: t.id, status: "active" } }),
      db(ctx).invite.count({ where: { tenantId: t.id } }),
      db(ctx).mailDomain.count({ where: { tenantId: t.id } }),
    ]);
    const flags = ((t.settings as { setup?: Flags } | null)?.setup ?? {}) as Flags;
    const steps: SetupStep[] = [
      { id: "details", done: !!(t.phone && t.address && t.city), to: "/business/settings/profile" },
      { id: "logo", done: !!t.logoUrl, to: "/business/settings/branding" },
      { id: "first", done: (stays ? rooms : listings) > 0, to: stays ? "/business/calendar" : "/business/listings/new" },
      { id: "team", done: members > 1 || invites > 0, optional: true, to: "/business/team" },
      { id: "email", done: domains > 0, optional: true, to: "/business/domains" },
      { id: "verify", done: t.verification === "verified" || t.verification === "pending", optional: true, to: "/business/settings" },
      { id: "apps", done: false, optional: true, to: "/business/marketplace" },
    ];
    const required = steps.filter((s) => !s.optional);
    const doneCount = required.filter((s) => s.done).length;
    return { type: t.type, name: t.name, steps, done: doneCount, total: required.length, complete: doneCount === required.length, hidden: !!flags.hidden, tourSeen: !!flags.tourSeen };
  }

  async setState(ctx: BusinessContext, patch: Flags) {
    if (!ctx.permissions.can(SETTINGS_PERM)) throw forbidden("Only the owner or a manager can change this.");
    const t = await db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id }, select: { settings: true } });
    const settings = ((t.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const next = { ...(settings.setup as Flags | undefined), ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}), ...(patch.tourSeen !== undefined ? { tourSeen: patch.tourSeen } : {}) };
    await db(ctx).tenant.update({ where: { id: ctx.business.id }, data: { settings: { ...settings, setup: next } as Prisma.InputJsonValue } });
    return this.status(ctx);
  }
}
