import React from "react";
import { Icon } from "../core/icons";
import { Menu } from "../core/ui";

// The branch the workspace is showing, in the top bar. People with all branches can pick "All branches" or any
// one; people limited to some branches pick among theirs; with a single branch it is just its name.

export function BranchPicker({ branch, allowed, canAll, onPick, allLabel = "All branches", label = "Branch" }) {
  const name = branch === "all" ? allLabel : branch;
  if (allowed.length <= 1) {
    return allowed.length ? <span className="pf-branch-fixed" title={`${label}: ${allowed[0]}`}><Icon name="map-pin" size={15} />{allowed[0]}</span> : null;
  }
  const options = [...(canAll ? [{ id: "all", label: allLabel, sub: `${allowed.length} branches together`, icon: "layers" }] : []), ...allowed.map((b) => ({ id: b, label: b, icon: "map-pin" }))];
  return (
    <Menu align="left" trigger={({ toggle, open }) => (
      <button type="button" className="pf-branch-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: ${name}. Change branch`}>
        <Icon name={branch === "all" ? "layers" : "map-pin"} size={15} /><span className="pf-ellipsis">{name}</span><Icon name="chevron-down" size={14} className="pf-wsx-chev" />
      </button>
    )}>
      <div className="pf-wsx-head">{canAll ? "Show branch" : "Your branches"}</div>
      {options.map((o) => (
        <button key={o.id} type="button" data-close="" className={`pf-wsx-item ${o.id === branch ? "on" : ""}`} aria-current={o.id === branch ? "true" : undefined} onClick={() => onPick(o.id)}>
          <Icon name={o.icon} size={16} />
          <span className="pf-wsx-name"><b className="pf-ellipsis">{o.label}</b>{o.sub && <small>{o.sub}</small>}</span>
          {o.id === branch && <Icon name="check" size={15} />}
        </button>
      ))}
    </Menu>
  );
}
