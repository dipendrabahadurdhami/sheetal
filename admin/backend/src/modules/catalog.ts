// Admin → Listing setup: the options every listing form offers, and which listing kinds each business type may
// create. Saved as the "catalog" app setting (backend-core/src/lib/catalog.ts); only lists staff changed are stored.
// Where it fits: the admin panel's Listing setup page; the business panel reads the result from GET /catalog.
// How it works: a whole list is saved at once (add, rename, reorder and delete are all a new list); "reset" goes
// back to the built-in list in shared/src/data/catalog.js. Grouped lists (property types per category, area names per
// district) are saved one group at a time.
// Rules: content.edit staff only; option ids are kept as they are, so listings that use them keep their labels.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest } from "@sheetal/backend-core/lib/errors";
import { CATALOG_KEY, readCatalog, type CatalogItem, type StoredCatalog } from "@sheetal/backend-core/lib/catalog";
import { LISTING_KINDS } from "@sheetal/backend-core/domain/listings";
import { BUSINESS_TYPES } from "@sheetal/backend-core/domain/permissions";
import { staffOf } from "./routes.js";

const Item = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/, "Ids use small letters, numbers and _."),
  en: z.string().trim().min(1, "Write the English name.").max(120),
  ne: z.string().trim().max(120).default(""),
  icon: z.string().trim().regex(/^[a-z0-9-]{1,40}$/).optional(),
}).catchall(z.unknown());
const KEY = /^[a-zA-Z][a-zA-Z0-9]{1,39}$/;
const PARENT = /^[a-z0-9][a-z0-9_-]{0,59}$/;
/** Lists kept per parent: property types per category (options), areas per district (plain names). */
const GROUPED: Record<string, "items" | "names"> = { propertyTypes: "items", areas: "names" };

export async function adminCatalogRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const save = async (next: StoredCatalog, actorId: string, ip: string, target: string) => {
    const value = { ...next, updatedAt: new Date().toISOString() };
    await db().appSetting.upsert({ where: { key: CATALOG_KEY }, create: { key: CATALOG_KEY, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
    await app.cache.del("catalog:stored");
    await db().auditLog.create({ data: { actorId, action: "admin.catalog_updated", target, ip } });
    return value;
  };

  app.get("/admin/catalog", async (request) => {
    staffOf(request, "content.edit");
    return { data: await readCatalog(db()) };
  });

  app.put<{ Params: { key: string } }>("/admin/catalog/lists/:key", async (request) => {
    const staff = staffOf(request, "content.edit");
    if (!KEY.test(request.params.key)) throw badRequest("Unknown list.");
    const { items } = z.object({ items: z.array(Item).max(1000) }).refine((b) => JSON.stringify(b).length <= 400_000, "The list is too long.").parse(request.body);
    const ids = new Set<string>();
    for (const it of items) { if (ids.has(it.id)) throw badRequest(`Two options use the id “${it.id}”.`); ids.add(it.id); }
    const cur = await readCatalog(db());
    const value = await save({ ...cur, lists: { ...(cur.lists ?? {}), [request.params.key]: items.map((it) => ({ ...it, ne: it.ne || it.en })) } }, staff.user.id, request.ip, request.params.key);
    return { message: "Saved. New and edited listings use it now.", data: value };
  });

  app.delete<{ Params: { key: string } }>("/admin/catalog/lists/:key", async (request) => {
    const staff = staffOf(request, "content.edit");
    const cur = await readCatalog(db());
    const lists = { ...(cur.lists ?? {}) };
    delete lists[request.params.key];
    const value = await save({ ...cur, lists }, staff.user.id, request.ip, `${request.params.key} reset`);
    return { message: "Back to the built-in list.", data: value };
  });

  app.put<{ Params: { key: string; parent: string } }>("/admin/catalog/groups/:key/:parent", async (request) => {
    const staff = staffOf(request, "content.edit");
    const { key, parent } = request.params;
    const kind = GROUPED[key];
    if (!kind || !PARENT.test(parent)) throw badRequest("Unknown list.");
    let items: CatalogItem[] | string[];
    if (kind === "names") {
      const names = z.object({ items: z.array(z.string().trim().min(1).max(80)).max(1000) }).parse(request.body).items;
      items = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()];
    } else {
      const list = z.object({ items: z.array(Item).max(500) }).parse(request.body).items;
      const ids = new Set<string>();
      for (const it of list) { if (ids.has(it.id)) throw badRequest(`Two options use the id “${it.id}”.`); ids.add(it.id); }
      items = list.map((it) => ({ ...it, ne: it.ne || it.en }));
    }
    const cur = await readCatalog(db());
    const prev = cur.lists?.[key];
    const group = { ...(prev && !Array.isArray(prev) ? prev : {}), [parent]: items };
    const value = await save({ ...cur, lists: { ...(cur.lists ?? {}), [key]: group } }, staff.user.id, request.ip, `${key} ${parent}`);
    return { message: "Saved. New and edited listings use it now.", data: value };
  });

  app.delete<{ Params: { key: string; parent: string } }>("/admin/catalog/groups/:key/:parent", async (request) => {
    const staff = staffOf(request, "content.edit");
    const { key, parent } = request.params;
    const cur = await readCatalog(db());
    const prev = cur.lists?.[key];
    const group: Record<string, CatalogItem[] | string[]> = { ...(prev && !Array.isArray(prev) ? prev : {}) };
    delete group[parent];
    const lists = { ...(cur.lists ?? {}), [key]: group };
    if (!Object.keys(group).length) delete lists[key];
    const value = await save({ ...cur, lists }, staff.user.id, request.ip, `${key} ${parent} reset`);
    return { message: "Back to the built-in list.", data: value };
  });

  app.put("/admin/catalog/kinds", async (request) => {
    const staff = staffOf(request, "content.edit");
    const types = [...BUSINESS_TYPES, "owner"] as [string, ...string[]];
    const { kindsByType } = z.object({ kindsByType: z.partialRecord(z.enum(types), z.array(z.enum(LISTING_KINDS)).max(LISTING_KINDS.length)) }).parse(request.body);
    const cur = await readCatalog(db());
    const value = await save({ ...cur, kindsByType: Object.fromEntries(Object.entries(kindsByType).map(([k, l]) => [k, [...new Set(l ?? [])]])) }, staff.user.id, request.ip, "listing kinds");
    return { message: "Saved. Each business type's New listing screen follows it.", data: value };
  });
}
