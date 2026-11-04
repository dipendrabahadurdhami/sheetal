// Plans and prices per business type.
// Where it fits: the admin panel's Plans page; prices show on the website's Plans page and in business billing.
// How it works: staff who manage plans change a plan's name, monthly price, limits and features, hide it from sale,
// or add a new one. Longer periods always get the PERIODS discount.
// Rules: changes apply to every business on that plan from now on; nobody is moved between plans here; Starter
// stays free and on sale.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, notFound } from "@sheetal/backend-core/lib/errors";
import { BUSINESS_TYPES } from "@sheetal/backend-core/domain/permissions";
import { PERIODS, priceFor } from "@sheetal/backend-core/domain/plans";
import { staffOf } from "./routes.js";

const FEATURE_KEYS = ["pos", "channel_sync", "agreements", "api", "custom_roles", "multi_property", "all_kinds"] as const;

const Limits = z.record(z.string().regex(/^[a-z_]{2,30}$/), z.number().int().min(-1).max(1_000_000)).refine((l) => Object.keys(l).length <= 20, "Too many limits.");
const Features = z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().optional()])) as Record<(typeof FEATURE_KEYS)[number], z.ZodOptional<z.ZodBoolean>>);
const Edit = z.object({
  name: z.string().trim().min(2, "Name the plan.").max(40),
  price: z.number().int().min(0).max(1_000_000),
  limits: Limits,
  features: Features,
  active: z.boolean(),
});

export async function adminPlanRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const audit = (actorId: string, ip: string, action: string, target: string, meta: object) =>
    db().auditLog.create({ data: { actorId, action, target, ip, meta: meta as object } });

  app.get("/admin/plans", async (request) => {
    staffOf(request, "tenants.view");
    const [plans, counts] = await Promise.all([
      db().plan.findMany({ orderBy: [{ type: "asc" }, { sort: "asc" }] }),
      db().tenant.groupBy({ by: ["planId"], where: { status: { notIn: ["cancelled"] } }, _count: true }),
    ]);
    const on = new Map(counts.map((c) => [c.planId, c._count]));
    return {
      data: plans.map((p) => ({ ...p, yearly: priceFor(p.price, 12), businesses: on.get(p.id) ?? 0 })),
      meta: { periods: PERIODS, features: FEATURE_KEYS },
    };
  });

  app.patch<{ Params: { id: string } }>("/admin/plans/:id", async (request) => {
    const s = staffOf(request, "plans.manage");
    const b = Edit.parse(request.body);
    const p = await db().plan.findUnique({ where: { id: request.params.id } });
    if (!p) throw notFound("Plan not found.");
    // The free Starter plan stays free: it is what every new business starts on.
    if (p.id.endsWith("-starter") && b.price > 0) throw badRequest("Starter is the free plan every business starts on; it stays free.");
    if (p.id.endsWith("-starter") && !b.active) throw badRequest("Starter can't be hidden; every new business starts on it.");
    await db().plan.update({ where: { id: p.id }, data: { name: b.name, price: b.price, limits: b.limits, features: b.features, active: b.active } });
    await audit(s.user.id, request.ip, "admin.plan_updated", p.id, { before: { name: p.name, price: p.price, active: p.active }, after: { name: b.name, price: b.price, active: b.active } });
    return { status: 200, message: `${b.name} saved.` };
  });

  app.post("/admin/plans", async (request) => {
    const s = staffOf(request, "plans.manage");
    const b = Edit.extend({ type: z.enum(BUSINESS_TYPES) }).parse(request.body);
    const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "plan";
    const id = `${b.type}-${slug}`;
    if (await db().plan.findUnique({ where: { id } })) throw badRequest(`There is already a ${b.name} plan for this business type.`);
    const last = await db().plan.findFirst({ where: { type: b.type }, orderBy: { sort: "desc" } });
    await db().plan.create({ data: { id, type: b.type, name: b.name, price: b.price, limits: b.limits, features: b.features, active: b.active, sort: (last?.sort ?? 0) + 1 } });
    await audit(s.user.id, request.ip, "admin.plan_created", id, { price: b.price });
    return { status: 200, message: `${b.name} added.`, data: { id } };
  });
}
