// "Try the demo": a real, throw-away business for a visitor, and its cleanup (FRONTEND-KIT.md section 8; roadmap stage 1.2).
// Where it fits: routes.ts calls startDemo() for POST /v1/demo/session; jobs.ts runs cleanupDemos() every hour (job "demo.cleanup").
// How it works:
//   startDemo()     creates a demo user (email owner.<key>@demo.sheetal.invalid, no password), a business of the asked type with `demo = true` and
//                   `demoExpiresAt` = now + 24 hours through the same createWorkspace() real sign-ups use, fills it with a few sample expenses and reviews
//                   (the two pages on the screen kit), and signs the visitor in as its owner. The business has no renewal date, so the billing run never sees it.
//   cleanupDemos()  deletes demo businesses whose time is up: every row that carries their tenant_id (found from the database's own column list, so a table
//                   added later is covered), then the business (its branches, roles and memberships go with it), then its demo users and their sessions.
//                   Audit rows are kept with the business emptied, as the schema says.
// Rules: only rows of a business with demo = true AND a passed demoExpiresAt are ever deleted, and only users on the reserved demo email domain.
// What a demo may change is fenced by platform/src/demo/guard.ts (an allow-list), not here. Sample amounts are whole rupees with the paisa column filled.

import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { Db } from "@sheetal/platform/db/client";
import { DEMO_EMAIL_DOMAIN } from "@sheetal/platform/demo/guard";
import { BUSINESS_TYPES, type BusinessType } from "@sheetal/backend-core/domain/permissions";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { newToken } from "@sheetal/backend-core/lib/secrets";

export const DEMO_HOURS = 24;
export const DEMO_TYPES = BUSINESS_TYPES;
const NAMES: Record<string, string> = { hotel: "Demo Hotel", host: "Demo Homestay", developer: "Demo Developers", agency: "Demo Realty", sponsor: "Demo Investments" };

/** Sample expenses: [days ago, category, rupees, vendor, method, status]. Categories are built-in ids (apps/expenses/backend/categories.ts). */
const EXPENSES: readonly (readonly [number, string, number, string, string, "confirmed" | "draft"])[] = [
  [1, "utilities", 4_850, "Nepal Electricity Authority", "esewa", "confirmed"],
  [3, "marketing", 12_000, "Facebook boost", "card", "confirmed"],
  [6, "repairs", 7_500, "Plumber: kitchen tap", "cash", "confirmed"],
  [9, "salaries", 85_000, "Staff salaries", "bank", "confirmed"],
  [0, "rent", 60_000, "Office rent", "bank", "draft"],
];
/** Sample reviews: [rating, comment, reply or null]. */
const REVIEWS: readonly (readonly [number, string, string | null])[] = [
  [5, "Very helpful team. They answered every question the same day.", "Thank you! We are glad we could help."],
  [4, "Good service. The office was a little hard to find.", null],
  [2, "I waited two days for a call back.", null],
];

const dayAgo = (now: Date, days: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));

/** Fills a new demo business with the sample rows. Exported for the test. */
export async function seedDemoData(tx: Pick<Db, "branch" | "expense" | "review" | "user">, o: { tenantId: string; ownerId: string; key: string; now: Date }) {
  const head = await tx.branch.findFirstOrThrow({ where: { tenantId: o.tenantId }, orderBy: { createdAt: "asc" } });
  for (const [days, category, amount, vendor, method, status] of EXPENSES) {
    await tx.expense.create({
      data: {
        tenantId: o.tenantId, branchId: head.id, status, spentOn: dayAgo(o.now, days), category, amount, amountPaisa: BigInt(amount * 100), vendor, method,
        createdBy: o.ownerId, ...(status === "confirmed" ? { confirmedBy: o.ownerId, confirmedAt: o.now } : {}),
      },
    });
  }
  for (const [i, [rating, comment, reply]] of REVIEWS.entries()) {
    const guest = await tx.user.create({ data: { email: `guest${i + 1}.${o.key}@${DEMO_EMAIL_DOMAIN}`, userName: ["Asha", "Bikram", "Chandra"][i] ?? "Guest", emailVerifiedAt: o.now } });
    await tx.review.create({
      data: { userId: guest.id, tenantId: o.tenantId, rating, comment, status: "published", createdAt: dayAgo(o.now, i + 2), ...(reply ? { reply, repliedAt: o.now, repliedBy: o.ownerId } : {}) },
    });
  }
}

export interface DemoApp { db?: Db; cache: { del(key: string): Promise<unknown> } }

/** Creates the demo business and signs the visitor in. Returns the sign-in token (the same kind a normal sign-in gives). */
export async function startDemo(app: DemoApp, o: { type: BusinessType; request: FastifyRequest; now?: Date }) {
  const db = app.db!;
  const now = o.now ?? new Date();
  const key = newToken().replace(/[^a-zA-Z0-9]/g, "").slice(0, 16).toLowerCase();
  const expiresAt = new Date(now.getTime() + DEMO_HOURS * 3_600_000);
  const made = await db.$transaction(async (tx) => {
    const owner = await tx.user.create({ data: { email: `owner.${key}@${DEMO_EMAIL_DOMAIN}`, userName: "Demo visitor", emailVerifiedAt: now } });
    // The middle plan of the type, so the visitor sees the paid pages too (Expenses). No renewal date: the billing run never bills it.
    const tenant = await createWorkspace(tx, { ownerId: owner.id, name: NAMES[o.type] ?? "Demo business", type: o.type, planId: `${o.type}-business`, city: "Kathmandu", emailVerified: true });
    await tx.tenant.update({ where: { id: tenant.id }, data: { demo: true, demoExpiresAt: expiresAt } });
    await seedDemoData(tx, { tenantId: tenant.id, ownerId: owner.id, key, now });
    return { ownerId: owner.id, tenantId: tenant.id };
  });
  const token = await createSession(app as never, made.ownerId, o.request);
  return { token, tenantId: made.tenantId, expiresAt };
}

const FK_VIOLATION = /foreign key|violates|23503/i;

/**
 * Deletes every demo business whose time is up, with all its rows and its demo users. Returns how many businesses were deleted.
 * Safe to run again after a failure: whatever is left is picked up by the next run.
 */
export async function cleanupDemos(db: Db, now: Date = new Date(), log?: Pick<FastifyBaseLogger, "warn">): Promise<number> {
  const due = await db.tenant.findMany({ where: { demo: true, demoExpiresAt: { lt: now } }, select: { id: true }, take: 200 });
  if (!due.length) return 0;
  // Every table that carries tenant_id, from the database itself (so a table added later is covered). audit_logs keeps its rows (the business is emptied).
  const tables = (await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'tenant_id' AND table_name <> 'audit_logs' ORDER BY table_name`,
  )).map((r: { table_name: string }) => r.table_name).filter((t: string) => /^[a-z_][a-z0-9_]*$/.test(t));
  let deleted = 0;
  for (const { id } of due) {
    try {
      const owners = await db.membership.findMany({ where: { tenantId: id, user: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } }, select: { user: { select: { email: true } } } });
      // Children before parents is not known here, so go round until nothing is refused any more (at most a few rounds).
      let left = tables;
      for (let round = 0; round < 6 && left.length; round++) {
        const again: string[] = [];
        for (const t of left) {
          try { await db.$executeRawUnsafe(`DELETE FROM "${t}" WHERE tenant_id = $1`, id); }
          catch (err) { if (FK_VIOLATION.test(String((err as Error).message))) again.push(t); else throw err; }
        }
        left = again;
      }
      // Only ever a demo business: the where repeats the flag on purpose.
      await db.tenant.deleteMany({ where: { id, demo: true } });
      for (const { user } of owners) {
        const key = /^owner\.([a-z0-9]+)@/.exec(user.email)?.[1];
        if (key) await db.user.deleteMany({ where: { email: { endsWith: `.${key}@${DEMO_EMAIL_DOMAIN}` } } });
      }
      deleted++;
    } catch (err) {
      log?.warn({ err, tenantId: id }, "demo cleanup: one demo business could not be deleted, will try again");
    }
  }
  return deleted;
}
