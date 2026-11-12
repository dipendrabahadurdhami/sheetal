// Property codes: every listing has a code like ER-0123 (the business's prefix and the listing's number).
// Where it fits: the business API gives new listings their code with listingCode(await prefixFor(...)); a business
// changes its prefix in Settings → Listings (business/backend/src/modules/listings/codes.ts), which gives all its
// listings the new prefix; `npm run listings:codes` gives every business without one its default prefix.
// How it works: the default prefix is the business name's initials (Everest Realty → ER); listings without a business
// (posted by people on the website) keep SP. The number never changes, so codes stay unique. Old codes are kept in
// listings.old_codes, so a code printed on an old agreement or sign still finds the listing.
// Rules: a prefix is 2 to 5 capital letters or digits, starting with a letter; TMP is reserved.

import type { Db } from "@sheetal/platform/db/client";

export const DEFAULT_PREFIX = "SP";
export const PREFIX_RE = /^[A-Z][A-Z0-9]{1,4}$/;
const SKIP = new Set(["PVT", "LTD", "PRIVATE", "LIMITED", "THE", "AND", "OF", "CO", "COMPANY", "INC"]);

/** A business name's initials: "Everest Realty Pvt Ltd" → "ER", "Lakeside" → "LA"; SP when nothing usable. */
export function initialsOf(name: string) {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w && !SKIP.has(w));
  const raw = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 2);
  return PREFIX_RE.test(raw) ? raw : DEFAULT_PREFIX;
}

/** ER-0123 (the number is never cut: ER-12345). */
export const listingCode = (prefix: string, id: number) => `${prefix}-${String(id).padStart(4, "0")}`;

/** The prefix a business's new listings get: the one it set, or its initials. */
export async function prefixFor(db: Pick<Db, "tenant">, tenantId: string | null | undefined) {
  if (!tenantId) return DEFAULT_PREFIX;
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, codePrefix: true } });
  return t?.codePrefix || (t ? initialsOf(t.name) : DEFAULT_PREFIX);
}

/** Gives every listing of a business the prefix, keeping each old code as an alias. Returns how many changed. */
export async function recodeListings(db: Pick<Db, "$executeRaw">, tenantId: string, prefix: string) {
  return db.$executeRaw`
    UPDATE listings
    SET old_codes = CASE WHEN code = ANY(old_codes) THEN old_codes ELSE array_append(old_codes, code) END,
        code = ${prefix}::text || '-' || CASE WHEN id < 10000 THEN lpad(id::text, 4, '0') ELSE id::text END
    WHERE tenant_id = ${tenantId} AND code NOT LIKE 'TMP-%'
      AND code <> ${prefix}::text || '-' || CASE WHEN id < 10000 THEN lpad(id::text, 4, '0') ELSE id::text END`;
}
