import React from "react";
import { Icon } from "../core/icons";
import { Menu } from "../core/ui";

// The business at the top of the sidebar: its logo and name; clicking the name lists the person's businesses,
// each with its type (hotel, developer…) and the person's role there, since the menu and access change with both.
// `big` is used when the business has its own branding and takes Sheetal's logo spot.

const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function Mark({ ws, size }) {
  return (
    <span className={`pf-wsx-mark ${ws.logoUrl ? "has-logo" : ""}`} style={{ width: size, height: size, ...(ws.logoUrl ? {} : { background: ws.color || "var(--btn-bg)", color: "#fff" }) }}>
      {ws.logoUrl ? <img src={ws.logoUrl} alt="" /> : initials(ws.name)}
    </span>
  );
}

export function WorkspaceSwitcher({ current, list, onPick, sub, footer, big = false, label = "Switch business" }) {
  const head = (toggle, open) => (
    <button type="button" className={`pf-wsx ${big ? "big" : ""}`} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`${current.name}. ${label}`}>
      <Mark ws={current} size={big ? 44 : 28} />
      <span className="pf-wsx-name"><b>{current.name}</b>{sub && <small>{sub}</small>}</span>
      <Icon name="chevron-down" size={15} className="pf-wsx-chev" />
    </button>
  );
  return (
    <Menu align="left" trigger={({ toggle, open }) => head(toggle, open)}>
      <div className="pf-wsx-head">Your businesses · {list.length}</div>
      {list.map((w) => (
        <button key={w.id} type="button" data-close="" className={`pf-wsx-item ${w.id === current.id ? "on" : ""}`} aria-current={w.id === current.id ? "true" : undefined} onClick={() => w.id !== current.id && onPick(w.id)}>
          <Mark ws={w} size={32} />
          <span className="pf-wsx-name"><b className="pf-ellipsis">{w.name}</b>{(w.typeLabel || w.role) && <small>{w.typeIcon && <Icon name={w.typeIcon} size={12} />}{[w.typeLabel, w.role].filter(Boolean).join(" · ")}</small>}</span>
          {w.id === current.id && <Icon name="check" size={15} />}
        </button>
      ))}
      {footer ? <><div className="pf-menu-sep" />{footer}</> : list.length === 1 && <p className="pf-wsx-note">Other businesses you own or are invited to will show here, each with its own menu and your role in it.</p>}
    </Menu>
  );
}
