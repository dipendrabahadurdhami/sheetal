import React, { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../core/i18n";
import { useRouter } from "../core/router";
import { Icon } from "../core/icons";

// Ctrl/Cmd + K: jump to any page or start any task without the sidebar.
export function CommandPalette({ nav, actions = [], records = [] }) {
  const t = useT();
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef(null);
  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } if (e.key === "Escape") setOpen(false); };
    const o = () => setOpen(true);
    document.addEventListener("keydown", h); document.addEventListener("pf-open-palette", o);
    return () => { document.removeEventListener("keydown", h); document.removeEventListener("pf-open-palette", o); };
  }, []);
  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  const items = useMemo(() => {
    const pages = nav.flatMap((g) => g.items).map((it) => ({ kind: "page", icon: it.icon, label: t(it.key), to: it.to }));
    const all = [...actions.map((a) => ({ kind: "action", ...a })), ...pages, ...records.map((r) => ({ kind: "record", ...r }))];
    const ql = q.toLowerCase().trim();
    return (ql ? all.filter((x) => `${x.label} ${x.sub || ""} ${x.keywords || ""}`.toLowerCase().includes(ql)) : all.filter((x) => x.kind !== "record")).slice(0, 12);
  }, [nav, actions, records, q, t]);
  if (!open) return null;
  const go = (x) => { setOpen(false); navigate(x.to); };
  return (
    <div className="overlay pf-palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="pf-palette" role="dialog" aria-label={t("cmd.title")}>
        <div className="pf-palette-in"><Icon name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder={t("cmd.placeholder")} aria-label={t("cmd.placeholder")}
            onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } if (e.key === "Enter" && items[i]) go(items[i]); }} />
          <kbd>Esc</kbd></div>
        <ul role="listbox">
          {items.length ? items.map((x, k) => (
            <li key={x.kind + x.label + k} role="option" aria-selected={k === i} className={k === i ? "on" : ""} onMouseEnter={() => setI(k)} onClick={() => go(x)}>
              <Icon name={x.icon} size={16} /><span>{x.label}{x.sub && <small>{x.sub}</small>}</span><em>{x.kind === "setting" ? "Setting" : t(`cmd.k_${x.kind}`)}</em>
            </li>
          )) : <li className="empty">{t("cmd.none")}</li>}
        </ul>
        <div className="pf-palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> {t("cmd.move")}</span><span><kbd>Enter</kbd> {t("cmd.open")}</span></div>
      </div>
    </div>
  );
}

export const openPalette = () => document.dispatchEvent(new Event("pf-open-palette"));
