// A business's branches (outlets, offices, sites): list, add, edit, rename, close, reopen, remove.
// Where it fits: Settings → Branches, the branch picker in the top bar, and branch access on the Team page.
// How it works: everyone sees the branches they work at; "settings.business" manages them. Work points at the branch
// id; team access holds branch names, so a rename updates everyone's access in the same transaction.
// Rules: a business keeps at least one open branch; a branch with any work in it, or someone's only branch, can't be
// removed (close it instead: its history stays). checkScopes() makes sure access names real, open branches.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { workspaceOf, type Workspace } from "../access.js";

const name = z.string().trim().min(2, "Give the branch a name.").max(60);
const text = (max: number) => z.string().trim().max(max).optional().nullable();
const fields = { address: text(200), phone: text(30), manager: text(80), receipt: text(80) };

type Tx = Prisma.TransactionClient;
const scopeList = (s: unknown) => (Array.isArray(s) ? s.filter((x): x is string => typeof x === "string") : null);

export async function branchRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const manage = (ws: Workspace) => { if (!ws.can("settings.business")) throw forbidden("Your role can't change branches."); };
  const audit = (ws: Workspace, ip: string, action: string, target?: string) =>
    db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip } });
  const branchOf = async (ws: Workspace, id: string) => {
    const b = await db().branch.findFirst({ where: { id, tenantId: ws.tenantId } });
    if (!b) throw notFound("Branch not found.");
    return b;
  };
  /** Every membership and pending invite of the business that is limited to some branches. */
  const scoped = async (tx: Tx, tenantId: string) => ({
    members: (await tx.membership.findMany({ where: { tenantId }, include: { user: true } })).filter((m) => scopeList(m.scopes)),
    invites: (await tx.invite.findMany({ where: { tenantId, status: "pending" } })).filter((i) => scopeList(i.scopes)),
  });

  app.get("/branches", async (request) => {
    const ws = workspaceOf(request);
    const [rows, rooms, listings, members] = await Promise.all([
      db().branch.findMany({ where: { tenantId: ws.tenantId }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
      db().room.groupBy({ by: ["branchId"], where: { tenantId: ws.tenantId, active: true }, _count: true }),
      db().listing.groupBy({ by: ["branchId"], where: { tenantId: ws.tenantId, status: { notIn: ["removed", "archived"] } }, _count: true }),
      db().membership.findMany({ where: { tenantId: ws.tenantId, status: "active" }, select: { scopes: true } }),
    ]);
    const mine = rows.filter((b) => ws.inBranch(b.name));
    return {
      data: {
        access: ws.branches,
        branches: mine.map((b) => ({
          id: b.id, name: b.name, address: b.address, phone: b.phone, manager: b.manager, receipt: b.receipt, status: b.status, sort: b.sort,
          rooms: rooms.find((r) => r.branchId === b.id)?._count ?? 0,
          listings: listings.find((r) => r.branchId === b.id)?._count ?? 0,
          // People who work here: those limited to this branch, plus everyone with all branches.
          staff: members.filter((m) => { const l = scopeList(m.scopes); return !l || l.includes(b.name); }).length,
        })),
      },
    };
  });

  app.post("/branches", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const b = z.object({ name, ...fields }).parse(request.body);
    if (await db().branch.findFirst({ where: { tenantId: ws.tenantId, name: { equals: b.name, mode: "insensitive" } } })) throw conflict(`There is already a branch called ${b.name}.`);
    const count = await db().branch.count({ where: { tenantId: ws.tenantId } });
    const row = await db().branch.create({ data: { tenantId: ws.tenantId, name: b.name, address: b.address, phone: b.phone, manager: b.manager, receipt: b.receipt, sort: count } });
    await audit(ws, request.ip, "branch.added", b.name);
    return { status: 201, message: `${b.name} added.`, data: { id: row.id } };
  });

  app.patch<{ Params: { id: string } }>("/branches/:id", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const b = z.object({ name: name.optional(), ...fields, status: z.enum(["open", "closed"]).optional(), sort: z.number().int().min(0).max(999).optional() }).parse(request.body);
    const br = await branchOf(ws, request.params.id);
    if (b.status === "closed" && br.status === "open" && !(await db().branch.count({ where: { tenantId: ws.tenantId, status: "open", id: { not: br.id } } }))) {
      throw badRequest("A business needs at least one open branch.");
    }
    const renamed = b.name && b.name !== br.name ? b.name : null;
    if (renamed && await db().branch.findFirst({ where: { tenantId: ws.tenantId, id: { not: br.id }, name: { equals: renamed, mode: "insensitive" } } })) throw conflict(`There is already a branch called ${renamed}.`);
    await db().$transaction(async (tx) => {
      await tx.branch.update({ where: { id: br.id }, data: { name: b.name, address: b.address, phone: b.phone, manager: b.manager, receipt: b.receipt, status: b.status, sort: b.sort } });
      if (!renamed) return;
      // The new name in everyone's branch access (work points at the branch itself).
      const { members, invites } = await scoped(tx, ws.tenantId);
      const swap = (s: unknown) => scopeList(s)!.map((x) => (x === br.name ? renamed : x));
      for (const m of members.filter((m) => scopeList(m.scopes)!.includes(br.name))) await tx.membership.update({ where: { id: m.id }, data: { scopes: swap(m.scopes) } });
      for (const i of invites.filter((i) => scopeList(i.scopes)!.includes(br.name))) await tx.invite.update({ where: { id: i.id }, data: { scopes: swap(i.scopes) } });
    });
    await audit(ws, request.ip, renamed ? "branch.renamed" : b.status ? `branch.${b.status === "open" ? "reopened" : "closed"}` : "branch.updated", renamed ? `${br.name} → ${renamed}` : br.name);
    return { message: renamed ? `Renamed to ${renamed}.` : b.status === "closed" ? `${br.name} closed.` : b.status === "open" ? `${br.name} reopened.` : `${br.name} saved.` };
  });

  app.delete<{ Params: { id: string } }>("/branches/:id", async (request) => {
    const ws = workspaceOf(request); manage(ws);
    const br = await branchOf(ws, request.params.id);
    if ((await db().branch.count({ where: { tenantId: ws.tenantId } })) <= 1) throw badRequest("A business needs at least one branch.");
    if (br.status === "open" && !(await db().branch.count({ where: { tenantId: ws.tenantId, status: "open", id: { not: br.id } } }))) throw badRequest("A business needs at least one open branch.");
    const w = { branchId: br.id };
    const [listings, rooms, leads, bookings, shifts, bills, invoices, expenses, recurring, rentOwners, rentUnits, forms, agreements, stockItems, attendance, leaves] = await Promise.all([
      db().listing.count({ where: { ...w, status: { not: "removed" } } }), db().room.count({ where: w }), db().lead.count({ where: w }),
      db().booking.count({ where: w }), db().shift.count({ where: w }), db().posBill.count({ where: w }), db().bizInvoice.count({ where: w }),
      db().expense.count({ where: w }), db().recurringExpense.count({ where: w }),
      db().rentOwner.count({ where: w }), db().rentUnit.count({ where: w }), db().form.count({ where: w }), db().agreement.count({ where: w }),
      db().stockItem.count({ where: w }), db().attendance.count({ where: w }), db().leaveRequest.count({ where: w }),
    ]);
    const work = [[listings, "listing"], [rooms, "room"], [leads, "enquiry"], [bookings, "booking"], [shifts + bills, "till record"], [invoices, "invoice"], [expenses + recurring, "expense"], [rentOwners + rentUnits, "rental record"], [forms, "online form"], [agreements, "agreement"], [stockItems, "stock item"], [attendance, "attendance record"], [leaves, "leave request"]]
      .filter(([n]) => n).map(([n, w]) => `${n} ${n === 1 ? w : w === "enquiry" ? "enquiries" : `${w}s`}`);
    if (work.length) throw badRequest(`${br.name} has ${work.join(", ")}. Move them to another branch, or close the branch instead (its history stays).`);
    await db().menuItem.deleteMany({ where: { tenantId: ws.tenantId, branchId: br.id } });
    await db().$transaction(async (tx) => {
      const { members, invites } = await scoped(tx, ws.tenantId);
      const only = members.filter((m) => { const l = scopeList(m.scopes)!; return l.length === 1 && l[0] === br.name; });
      if (only.length) throw badRequest(`${only.map((m) => m.user.userName).join(", ")} only work${only.length > 1 ? "" : "s"} at ${br.name}. Give them another branch on the Team page first.`);
      for (const m of members.filter((m) => scopeList(m.scopes)!.includes(br.name))) await tx.membership.update({ where: { id: m.id }, data: { scopes: scopeList(m.scopes)!.filter((x) => x !== br.name) } });
      for (const i of invites.filter((i) => scopeList(i.scopes)!.includes(br.name))) {
        const left = scopeList(i.scopes)!.filter((x) => x !== br.name);
        await tx.invite.update({ where: { id: i.id }, data: { scopes: left.length ? left : "all" } });
      }
      await tx.branch.delete({ where: { id: br.id } });
    });
    await audit(ws, request.ip, "branch.removed", br.name);
    return { message: `${br.name} removed.` };
  });
}

/** Branch access must name real, open branches of the business (or be "all"). */
export async function checkScopes(app: FastifyInstance, tenantId: string, scopes: "all" | string[] | undefined) {
  if (!scopes || scopes === "all") return scopes;
  if (!scopes.length) throw badRequest("Pick at least one branch, or all branches.");
  const open = await dbOf(app).branch.findMany({ where: { tenantId, status: "open", name: { in: scopes } }, select: { name: true } });
  const missing = scopes.filter((s) => !open.some((b) => b.name === s));
  if (missing.length) throw badRequest(`${missing.join(", ")} ${missing.length > 1 ? "aren't open branches" : "isn't an open branch"} of this business.`);
  return [...new Set(scopes)];
}
