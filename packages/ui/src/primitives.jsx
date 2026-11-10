// The UI kit: buttons, badges, panels, page headings, stats, tables, tabs, fields, inputs, menus, drawers, modals,
// confirmations and toasts.
// Where it fits: every screen in both panels. Moved here from shared/src/core/ui.jsx (task P1-FE-1); that file is now a shim.
// How it works: plain React components styled by shared/src/styles. Nothing in this file changed in the move except the import paths.
// Rules: keep every exported name and prop as it was; new components go in crud/ or their own file, not here.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "@sheetal/shared/core/icons";
import { useT } from "@sheetal/shared/core/i18n";
import { initials, limitText } from "@sheetal/shared/core/format";
import { useRouter } from "@sheetal/shared/core/router";

const cx = (...a) => a.filter(Boolean).join(" ");

export function Button({ variant = "primary", size, icon, children, className, block, ...p }) {
  return (
    <button type="button" className={cx("btn", `btn-${variant}`, size && `btn-${size}`, block && "btn-block", className)} {...p}>
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 16} />}{children}
    </button>
  );
}

export const IconButton = ({ icon, label, size = 18, className, ...p }) => (
  <button type="button" className={cx("btn btn-ghost btn-icon", className)} aria-label={label} title={label} {...p}>
    <Icon name={icon} size={size} />
  </button>
);

// Status meaning → look. Every badge = icon + word, never colour alone.
const TONE_ICON = { action: "circle-alert", progress: "clock", done: "check", problem: "x", neutral: "minus" };
export const STATUS_TONE = {
  active: "done", trial: "progress", past_due: "action", pending_verification: "action", suspended: "problem",
  invited: "action", pending: "action", expired: "neutral", revoked: "neutral", disabled: "neutral",
  draft: "neutral", published: "done", in_review: "progress", rejected: "problem",
  paid: "done", overdue: "action", failed: "problem", refunded: "neutral",
};
export const Badge = ({ tone = "neutral", icon, children }) => (
  <span className={cx("pf-badge", tone)}><Icon name={icon || TONE_ICON[tone]} size={13} />{children}</span>
);
export function StatusBadge({ status }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[status] || "neutral"}>{t(`status.${status}`)}</Badge>;
}

export function Panel({ title, sub, actions, children, className, pad, ...p }) {
  return (
    <section className={cx("card pf-panel", className)} {...p}>
      {(title || actions) && (
        <div className="pf-panel-head">
          <div className="pf-panel-title"><h2>{title}</h2>{sub && <span>{sub}</span>}</div>
          {actions && <div className="pf-panel-actions">{actions}</div>}
        </div>
      )}
      <div className={pad ? "pf-pad" : undefined}>{children}</div>
    </section>
  );
}

export const EmbedCtx = createContext(false);
export function PageHead({ title, sub, actions, back }) {
  const embedded = useContext(EmbedCtx);
  if (embedded) return actions ? <div className="pf-row-actions pf-embed-actions">{actions}</div> : null;
  return (
    <div className="pf-head">
      <div className="pf-head-text">
        {back}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="pf-head-actions">{actions}</div>}
    </div>
  );
}

export const Stat = ({ label, value, note, noteIcon, tone, to }) => {
  const { navigate } = useRouter();
  const inner = (<>
    <span>{label}</span>
    <b>{value}</b>
    {note && <small className={tone ? `pf-tone-${tone}` : undefined}>{noteIcon && <Icon name={noteIcon} size={14} />}{note}</small>}
    {to && <Icon name="arrow-up-right" size={15} className="pf-stat-go" />}
  </>);
  return to ? <button type="button" className="card pf-stat link" onClick={() => navigate(to)}>{inner}</button> : <div className="card pf-stat">{inner}</div>;
};

export function Table({ columns, rows, onRowClick, empty, rowKey = "id", minWidth = 720 }) {
  if (!rows.length) return empty || null;
  return (
    <div className="pf-table-wrap">
      <table className="table pf-table" style={{ minWidth }}>
        <thead><tr>{columns.map((c) => <th key={c.key} style={{ width: c.width, textAlign: c.align }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[rowKey]} className={onRowClick ? "click" : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key} style={{ textAlign: c.align }} className={c.num ? "tnum" : undefined}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="tabs pf-tabs" role="tablist">
    {tabs.map((tb) => (
      <button key={tb.id} role="tab" aria-selected={value === tb.id} className={value === tb.id ? "on" : ""} onClick={() => onChange(tb.id)}>
        {tb.icon && <Icon name={tb.icon} size={16} />}{tb.label}{tb.count != null && <span className="pf-tab-count tnum">{tb.count}</span>}
      </button>
    ))}
  </div>
);

export const Seg = ({ options, value, onChange, label }) => (
  <div className="seg" role="radiogroup" aria-label={label}>
    {options.map((o) => (
      <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? "on" : ""} onClick={() => onChange(o.id)}>
        {o.icon && <Icon name={o.icon} size={15} />}{o.label}
      </button>
    ))}
  </div>
);

export function Field({ label, hint, error, children, optional, className }) {
  const t = useT();
  return (
    <div className={cx("field", className)}>
      {label && <label>{label}{optional && <span className="muted" style={{ fontWeight: 400 }}> ({t("common.optional")})</span>}</label>}
      {children}
      {error ? <span className="pf-error"><Icon name="circle-alert" size={14} />{error}</span> : hint ? <span className="pf-hint">{hint}</span> : null}
    </div>
  );
}

export const Input = (p) => <input className="input" {...p} />;
export const Textarea = (p) => <textarea className="textarea" {...p} />;
export const Select = ({ value, onChange, options, ...p }) => (
  <select className="select" value={value} onChange={(e) => onChange(e.target.value)} {...p}>
    {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
  </select>
);

export function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="pf-search">
      <Icon name="search" size={15} />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export const Toggle = ({ checked, onChange, label, disabled }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
    className={cx("pf-switch", checked && "on")} onClick={() => onChange(!checked)}><span /></button>
);

export function ToggleRow({ title, sub, checked, onChange, disabled }) {
  return (
    <div className="pf-toggle-row">
      <div><b>{title}</b>{sub && <span>{sub}</span>}</div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export const Checkbox = ({ checked, onChange, label, disabled, sub }) => (
  <label className={cx("check pf-check", disabled && "is-disabled")}>
    <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}{sub && <small>{sub}</small>}</span>
  </label>
);

function useEsc(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  const t = useT();
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("modal pf-modal", wide && "modal-lg")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="pf-modal-head"><h3>{title}</h3><IconButton icon="x" label={t("common.close")} onClick={onClose} /></div>
        <div className="pf-modal-body">{children}</div>
        {footer && <div className="pf-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, sub, children, footer }) {
  const t = useT();
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="pf-scrim" onClick={onClose} />
      <aside className="pf-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="pf-drawer-head">
          <div><h3>{title}</h3>{sub && <span className="small muted">{sub}</span>}</div>
          <IconButton icon="x" label={t("common.close")} onClick={onClose} />
        </div>
        <div className="pf-drawer-body">{children}</div>
        {footer && <div className="pf-drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

export function Confirm({ open, onClose, onConfirm, title, children, confirmLabel, danger }) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant={danger ? "outline" : "primary"} className={danger ? "pf-danger" : undefined} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button></>}>
      <div className="small" style={{ color: "var(--text)" }}>{children}</div>
    </Modal>
  );
}

export const Empty = ({ icon = "search", title, children, action }) => (
  <div className="pf-empty"><Icon name={icon} size={40} strokeWidth={1.4} /><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>
);

export function Avatar({ name, size = 36, src }) {
  const [err, setErr] = useState(false);
  const s = { width: size, height: size, fontSize: Math.round(size / 2.8) };
  return src && !err
    ? <img className="avatar" style={s} src={src} alt="" onError={() => setErr(true)} />
    : <span className="avatar" style={s}>{initials(name)}</span>;
}

export function Person({ name, sub, size = 34 }) {
  return (
    <span className="pf-person"><Avatar name={name} size={size} /><span><b>{name}</b>{sub && <small>{sub}</small>}</span></span>
  );
}

export function Meter({ label, used, limit }) {
  const t = useT();
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const near = !unlimited && pct >= 90;
  return (
    <div className="pf-meter">
      <div className="pf-meter-top"><span>{label}</span><b className="tnum">{used.toLocaleString("en-IN")} / {unlimited ? t("common.unlimited") : limitText(limit)}</b></div>
      <div className="bar" role="img" aria-label={`${label}: ${used} of ${unlimited ? "unlimited" : limit}`}><i style={{ width: unlimited ? "4%" : `${pct}%` }} /></div>
      {near && <span className="pf-hint pf-tone-action"><Icon name="circle-alert" size={13} />{t("common.nearLimit")}</span>}
    </div>
  );
}

// Click-outside dropdown menu
export function Menu({ trigger, children, align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="pf-menu-wrap" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && <div className={cx("menu pf-menu", align === "left" && "left")} onClick={(e) => e.target.closest("[data-close]") && setOpen(false)}>{children}</div>}
    </div>
  );
}

// Toasts
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, ms = 3200) => {
    const id = Math.random();
    setItems((x) => [...x, { id, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts pf-toasts" role="status" aria-live="polite">{items.map((i) => <div key={i.id} className="toast">{i.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// Sticky bar shown while a settings form has unsaved changes. Same in admin, business and website account pages.
export function SaveBar({ dirty, onSave, onDiscard, disabled, label = "You have unsaved changes" }) {
  if (!dirty) return null;
  return (
    <div className="pf-savebar" role="region" aria-label={label}>
      <Icon name="circle-alert" size={16} /><span>{label}</span>
      {onDiscard && <Button variant="ghost" size="sm" onClick={onDiscard}>Discard</Button>}
      <Button size="sm" disabled={disabled} onClick={onSave}>Save changes</Button>
    </div>
  );
}
