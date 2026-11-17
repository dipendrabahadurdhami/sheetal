// The branch button in the top bar of the business panel.
// How it works: always opens a menu: "All branches" (for people with all branches) and their branches, plus an
// optional footer link (add or manage branches). With a single branch it just shows its name.

import React from "react";
import { Icon } from "../core/icons";
import { Menu } from "../core/ui";

export function BranchPicker({ branch, allowed, canAll, onPick, footer, allLabel = "All branches", label = "Branch" }) {
  if (!allowed.length) return null;
  const single = allowed.length === 1;
  // One branch and nothing to manage (not an owner or manager): there is nothing to pick, so show nothing.
  if (single && !footer) return null;
  const current = single ? allowed[0] : branch;
  const name = current === "all" ? allLabel : current;
  const options = [...(canAll && !single ? [{ id: "all", label: allLabel, sub: `${allowed.length} branches together`, icon: "layers" }] : []), ...allowed.map((b) => ({ id: b, label: b, icon: "map-pin" }))];
  return (
    <Menu align="left" trigger={({ toggle, open }) => (
      <button type="button" className="pf-branch-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: ${name}. Change branch`}>
        <Icon name={current === "all" ? "layers" : "map-pin"} size={15} /><span className="pf-ellipsis">{name}</span><Icon name="chevron-down" size={14} className="pf-wsx-chev" />
      </button>
    )}>
      <div className="pf-wsx-head">{single ? "Your branch" : canAll ? "Show branch" : "Your branches"}</div>
      {options.map((o) => (
        <button key={o.id} type="button" data-close="" className={`pf-wsx-item ${o.id === current ? "on" : ""}`} aria-current={o.id === current ? "true" : undefined} onClick={() => onPick(o.id)}>
          <Icon name={o.icon} size={16} />
          <span className="pf-wsx-name"><b className="pf-ellipsis">{o.label}</b>{o.sub && <small>{o.sub}</small>}</span>
          {o.id === current && <Icon name="check" size={15} />}
        </button>
      ))}
      {footer && <><div className="pf-menu-sep" />{footer}</>}
    </Menu>
  );
}
