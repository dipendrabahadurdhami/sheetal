// The team structure: who reports to whom, by branch.

import React from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { roleName } from "@sheetal/shared/core/rbac";
import { Person } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { branchesOf } from "./Branches";

/* ───────── Structure: who reports to whom, by branch ───────── */
export function Structure({ tenant }) {
  const t = useT();
  const { db } = useStore();
  const members = (db.members[tenant.id] || []).filter((m) => m.status !== "suspended");
  const roles = db.tenantRoles[tenant.id];
  const role = (m) => roles.find((r) => r.id === m.roleId);
  const owner = members.filter((m) => role(m)?.perms.includes("*"));
  const head = members.filter((m) => !role(m)?.perms.includes("*") && m.scopes === "all");
  const branches = branchesOf(db, tenant).filter((b) => b.status === "open");
  const Node = ({ m }) => <div className="pf-org-node"><Person name={m.name} sub={roleName(role(m), t)} size={32} /></div>;
  return (
    <div className="pf-org">
      <div className="pf-org-level"><span className="pf-org-label"><Icon name="crown" size={14} />{t("org.owner")}</span><div className="pf-org-row">{owner.map((m) => <Node key={m.id} m={m} />)}</div></div>
      <div className="pf-org-level"><span className="pf-org-label"><Icon name="building-2" size={14} />{t("org.head")}</span><div className="pf-org-row">{head.length ? head.map((m) => <Node key={m.id} m={m} />) : <span className="small muted">—</span>}</div></div>
      <div className="pf-org-level"><span className="pf-org-label"><Icon name="git-branch" size={14} />{t("org.branches")}</span>
        <div className="pf-org-branches">{branches.map((b) => {
          const staff = members.filter((m) => m.scopes !== "all" && m.scopes.includes(b.name));
          return (
            <section key={b.id} className="pf-org-branch">
              <header><b>{b.name}</b><span className="small muted tnum">{t("roles.people", { n: staff.length })}</span></header>
              <div className="pf-org-mgr"><span className="tiny muted">{t("br.manager")}</span><b>{b.manager}</b></div>
              {staff.length ? staff.map((m) => <Node key={m.id} m={m} />) : <span className="small muted">{t("org.noStaff")}</span>}
            </section>
          );
        })}</div>
      </div>
      <p className="pf-hint"><Icon name="info" size={13} />{t("org.note")}</p>
    </div>
  );
}
