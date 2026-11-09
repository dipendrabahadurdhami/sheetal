// Admin → Add-ons: the price of each add-on, which business types can buy it, and whether it is on sale.
// Where it fits: the admin panel (LiveAddons.jsx). Businesses buy them in Billing (business API billing/addons.ts).
// Rules: billing.view reads; plans.manage changes. A new price counts for new purchases and the next renewals.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { notFound } from "@sheetal/backend-core/lib/errors";
import { ADDON_DEFAULTS, addonCatalog } from "@sheetal/backend-core/domain/addons";
import { BUSINESS_TYPES } from "@sheetal/backend-core/domain/permissions";
import { staffOf } from "./routes.js";

export async function adminAddonRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);

  app.get("/admin/addons", async (request) => {
    staffOf(request, "billing.view");
    const [cat, owned] = await Promise.all([addonCatalog(db()), db().tenantAddon.groupBy({ by: ["addonId"], where: { qty: { gt: 0 } }, _sum: { qty: true }, _count: true })]);
    return { data: cat.map((a) => { const o = owned.find((x) => x.addonId === a.id); return { ...a, businesses: o?._count ?? 0, units: o?._sum.qty ?? 0 }; }) };
  });

  app.put<{ Params: { id: string } }>("/admin/addons/:id", async (request) => {
    const s = staffOf(request, "plans.manage");
    const def = ADDON_DEFAULTS.find((a) => a.id === request.params.id);
    if (!def) throw notFound("Add-on not found.");
    const b = z.object({
      name: z.string().trim().min(2).max(60), sub: z.string().trim().max(120).default(""),
      price: z.number().int("Use whole rupees.").min(0).max(1_000_000), types: z.array(z.enum(BUSINESS_TYPES)).min(1, "Choose at least one business type."), active: z.boolean(),
    }).parse(request.body);
    const saved = ((await db().appSetting.findUnique({ where: { key: "addons" } }))?.value ?? {}) as Record<string, unknown>;
    const value = { ...saved, [def.id]: b } as Prisma.InputJsonValue;
    await db().appSetting.upsert({ where: { key: "addons" }, create: { key: "addons", value }, update: { value } });
    await db().auditLog.create({ data: { actorId: s.user.id, action: "admin.addon_saved", target: `${def.id} Rs. ${b.price}`, ip: request.ip } });
    return { message: "Saved. The new price counts for new purchases and the next renewals." };
  });
}
