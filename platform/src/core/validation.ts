// Shared zod pieces for request input: ids, calendar days, months, paging and sorting.
// Where it fits: schemas of every app (create/update bodies, list queries) and BaseController's list query.
// How it works: small schemas that give the plain-English messages the forms show next to a field (errorHandler turns a
// ZodError into 422 with these messages). Day and Month stay strings ("2026-11-09", "2026-11"): a calendar date has no time.
// Rules: the exact Expenses versions were not in the P1-BE-1 zip; these follow the formats KERNEL.md names (YYYY-MM-DD,
// YYYY-MM, ids cut at 40 characters). P1-BE-5 compares them with expenses/routes.ts and aligns messages if they differ.

import { z } from "zod";
import type { ListQuery, SortSpec } from "./repository.js";

/** A record id as the routes take it. Ids are cuid()s; 40 matches the `id.slice(0, 40)` the routes use today. */
export const Id = z.string().trim().min(1, "Missing id.").max(40, "That id is too long.");

/** A calendar day, "2026-11-09": real dates only (not 2026-02-30). */
export const Day = z.string().trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-09.")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "That date doesn't exist.");

/** A month, "2026-11". */
export const Month = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11.");

/** ?page=&per= (1-based page; per is capped again by the repository's maxPerPage). Both optional. */
export const Page = z.object({
  page: z.coerce.number().int("Page must be a whole number.").min(1, "Page starts at 1.").optional(),
  per: z.coerce.number().int("Per page must be a whole number.").min(1, "Per page starts at 1.").max(1000, "Per page is too large.").optional(),
});

/** ?sort=spentOn:desc,seq:desc  ->  [{ field: "spentOn", dir: "desc" }, ...]. A field alone means ascending. */
export const Sort = z.string().trim().max(200)
  .regex(/^[A-Za-z][A-Za-z0-9_]*(:(asc|desc))?(,[A-Za-z][A-Za-z0-9_]*(:(asc|desc))?)*$/, "Sort like spentOn:desc,seq:asc.")
  .transform((s): SortSpec[] => s.split(",").map((p) => {
    const [field = "", dir] = p.split(":");
    return { field, dir: dir === "desc" ? "desc" : "asc" };
  }));

/** page, per, sort and q from a query string, as a ListQuery (no filters: an app adds its own filter fields). */
export const BasicListQuery = Page.extend({ sort: Sort.optional(), q: z.string().trim().max(100).optional() })
  .transform((v): ListQuery => ({ page: v.page, per: v.per, sort: v.sort, q: v.q || undefined }));
