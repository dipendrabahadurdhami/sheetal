// The team of a business on the business API: members, invitations, recent activity, and the role screen's data.
// Where it fits: Business → Team → Members when signed in. business/frontend/src/pages/BusinessPages.jsx renders it for a real business and passes in
// what the panel shell knows (the permission groups for the business type, the plan's name, whether this person may manage the team). Moved here in
// P2-W6 from live.js (liveTeam) and BusinessTeam, on the kit and the SDK.
// How it works: useApiGet loads GET /team (members, pending invitations, roles, seats, activity) and GET /branches (to send branch IDS, ACCESS.md
// section 3) again when the business, the branch picked at the top, or a change happen. The member list shows only people who work at the picked branch.
// Every change shows the server's message and reloads; `onChanged` lets the panel shell reload its own copy (menu, search, role picker).
// Rules: nothing is kept in the browser. The shared TeamPanel draws the screen; this page only maps the server's answer to its shape.

import React, { useEffect } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useBranch } from "@sheetal/shared/core/branch";
import { TeamPanel } from "@sheetal/shared/components/TeamPanel";
import { useToast } from "@sheetal/ui/primitives";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";
import { branchBody, worksAt } from "@sheetal/sdk/branchAccess";

/** A server member in the shape TeamPanel uses ("paused" on the server is "suspended" on screen). */
export const toMember = (m) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone || "", roleId: m.roleId, status: m.status === "paused" ? "suspended" : m.status, lastActive: m.lastActive, scopes: m.scopes, branchIds: m.branchIds, twofa: false });
export const toInvite = (i) => ({ id: i.id, email: i.email, roleId: i.roleId, scopes: i.scopes, branchIds: i.branchIds, status: i.status, sent: i.sent, expires: i.expires, by: i.by || "" });
export const toRole = (r) => ({ id: r.id, key: r.key, name: r.name || undefined, perms: r.perms, system: r.system });
/** "business.member_invited" -> "member invited", followed by its target. */
export const activityText = (a) => `${a.what.replace(/^\w+\./, "").replace(/_/g, " ")}${a.target ? ` ${a.target}` : ""}`;

/** The body of a member change: role, branch access by id, and paused/active; undefined when nothing the server keeps changed. */
export function memberBody(patch, branches) {
  const body = { roleId: patch.roleId, ...branchBody(patch.scopes, branches), status: patch.status ? (patch.status === "suspended" ? "paused" : "active") : undefined };
  return Object.values(body).every((v) => v === undefined) ? undefined : body;
}

export function TeamPage({ tenant, groups, planName, canManage, onChanged }) {
  const t = useT();
  const toast = useToast();
  const { branch, branchId } = useBranch() || {};
  const team = useApiGet("/team");
  const br = useApiGet("/branches");
  useEffect(() => { if (team.error) toast(team.error.message); }, [team.error, toast]);
  const branches = br.data?.branches || [];
  const data = team.data;

  const run = (p) => p.then((r) => { if (r?.message) toast(r.message); team.refresh(); onChanged?.(); return r; })
    .catch((e) => { toast(e.message); team.refresh(); });

  if (!data) return <div className="sk" style={{ height: 360, borderRadius: "var(--r)" }} />;
  const members = data.members.map(toMember).filter((m) => worksAt(m, branchId, branch));
  return (
    <TeamPanel members={members} invites={data.invites.map(toInvite)} roles={data.roles.map(toRole)} groups={groups}
      scopes={{ label: t(`scope.${tenant.type}`), options: branches.filter((b) => b.status === "open").map((b) => b.name) }}
      seats={{ limit: data.seats.limit, plan: planName }} canManage={canManage} dataKind="team"
      activity={data.activity.map((a) => ({ id: a.id, who: a.who, what: activityText(a), at: a.at }))}
      onInvite={(list) => run(bizApi("POST", "/team/invites", { invites: list.map((i) => ({ email: i.email, roleId: i.roleId, ...branchBody(i.scopes || "all", branches) })) }))}
      onUpdateMember={(id, patch) => { const body = memberBody(patch, branches); if (body) run(bizApi("PATCH", `/team/members/${id}`, body)); }}
      onRemoveMember={(id) => run(bizApi("DELETE", `/team/members/${id}`))}
      onRestoreMember={() => toast("Invite them again to bring them back.")}
      onResend={(id) => run(bizApi("POST", `/team/invites/${id}/resend`))}
      onRevoke={(id) => run(bizApi("POST", `/team/invites/${id}/revoke`))} />
  );
}
