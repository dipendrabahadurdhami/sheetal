// Settings → Branches: the Workspace app's BranchesPage (apps/workspace/frontend, P2-W6), plus branchesOf() for the shell's branch picker.
// How it works: branchesOf() gives a business's branches as live.js loaded them from the business API (the open ones' names are also tenant.scopes).
// Rules: the sample screens that were here (calendar, booking and invoice forms on browser storage) went with the sample workspace (P2-W6).

import React from "react";
import { can } from "@sheetal/shared/core/rbac";
import { branchesRefresh } from "../live";
import { BranchesPage } from "@sheetal/app-workspace/frontend";

/** The business's branches as live.js loaded them (empty until the first answer). */
export const branchesOf = (db, tenant) => db.branches?.[tenant.id] || [];

/* ───────── Branches of a signed-in business: the Workspace app's page (apps/workspace/frontend, P2-W6) ───────── */
export function LiveBranches({ tenant, role }) {
  return <BranchesPage tenant={tenant} onChanged={branchesRefresh}
    canManage={can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete")} />;
}
