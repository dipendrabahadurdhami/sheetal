import React from "react";
import { Icon } from "../core/icons";
import { Menu } from "../core/ui";

// The business at the top of the sidebar: its logo and name; clicking the name lists the person's other
// businesses. `big` is used when the business has its own branding and takes Sheetal's logo spot.

const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function Mark({ ws, size }) {
  return (
    <span className={`pf-wsx-mark ${ws.logoUrl ? "has-logo" : ""}`} style={{ width: size, height: size, ...(ws.logoUrl ? {} : { background: ws.color || "var(--btn-bg)", color: "#fff" }) }}>
      {ws.logoUrl ? <img src={ws.logoUrl} alt="" /> : initials(ws.name)}
    </span>
  );
}

export function WorkspaceSwitcher({ current, list, onPick, sub, big = false, label = "Switch business" }) {
  const others = list.filter((w) => w.id !== current.id);
  const head = (toggle, open) => (
    <button type="button" className={`pf-wsx ${big ? "big" : ""}`} onClick={others.length ? toggle : undefined} aria-haspopup={others.length ? "menu" : undefined} aria-expanded={others.length ? open : undefined} aria-label={others.length ? `${current.name}. ${label}` : current.name}>
      <Mark ws={current} size={big ? 44 : 28} />
      <span className="pf-wsx-name"><b>{current.name}</b>{sub && <small>{sub}</small>}</span>
      {others.length > 0 && <Icon name="chevron-down" size={15} className="pf-wsx-chev" />}
    </button>
  );
  if (!others.length) return head(() => {}, false);
  return (
    <Menu align="left" trigger={({ toggle, open }) => head(toggle, open)}>
      {list.map((w) => (
        <button key={w.id} type="button" data-close="" className={w.id === current.id ? "on" : undefined} onClick={() => w.id !== current.id && onPick(w.id)}>
          <Mark ws={w} size={22} /><span className="pf-ellipsis">{w.name}</span>{w.id === current.id && <Icon name="check" size={14} />}
        </button>
      ))}
    </Menu>
  );
}
