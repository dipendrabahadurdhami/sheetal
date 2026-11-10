// The listing options Sheetal staff change in Admin → Listing setup, saved as the "catalog" app setting.
// Where it fits: the admin API saves it (admin/backend/src/modules/catalog.ts); the business API (GET /catalog) and the
// website API (GET /catalog) send it to the screens, which lay it over shared/src/data/catalog.js (mergeCatalog), so
// the listing wizard, the website's filters and labels follow; the business API checks new listings' kinds against
// kindsByType.
// How it works: only what staff changed is stored: { lists: { facilities: [...], propertyTypes: { house: [...] },
// areas: { kathmandu: ["Dhapasi", …] } }, kindsByType: { agency: [...] } }. catalogKindsNow() gives the last
// kindsByType it read and refreshes it in the background at most once a minute.

import type { Db } from "./db.js";

export const CATALOG_KEY = "catalog";
export interface CatalogItem { id: string; en: string; ne: string; icon?: string; [extra: string]: unknown }
/** A plain list, or a grouped one (property types per category, area names per district). */
export type StoredList = CatalogItem[] | Record<string, CatalogItem[] | string[]>;
export interface StoredCatalog { lists?: Record<string, StoredList>; kindsByType?: Record<string, string[]>; forms?: Record<string, unknown>; updatedAt?: string }

export async function readCatalog(db: Db): Promise<StoredCatalog> {
  const row = await db.appSetting.findUnique({ where: { key: CATALOG_KEY } });
  return (row?.value ?? {}) as StoredCatalog;
}

let kinds: Record<string, string[]> | undefined;
let loadedAt = 0;
let loading = false;

/** Which listing kinds each business type may create, as staff set them (undefined = the built-in rule). */
export function catalogKindsNow(db: Db | undefined): Record<string, string[]> | undefined {
  if (db && !loading && Date.now() - loadedAt > 60_000) {
    loading = true;
    readCatalog(db).then((c) => { kinds = c.kindsByType; loadedAt = Date.now(); }).catch(() => {}).finally(() => { loading = false; });
  }
  return kinds;
}

export async function warmCatalog(db: Db) {
  kinds = (await readCatalog(db)).kindsByType;
  loadedAt = Date.now();
}
