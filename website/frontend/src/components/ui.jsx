import React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, X, Star, SearchX } from "lucide-react";
import { imgUrl } from "../utils/format";
import { Avatar as BaseAvatar } from "@sheetal/shared/core/ui";

export const Logo = ({ small }) => (
  <Link to="/" className="brand" aria-label="Sheetal Property home">
    <img src="/brand/logo-mark.png" alt="" style={small ? { height: 28 } : undefined} />
    <span className="brand-word"><b>SHEETAL</b><span>PROPERTY</span></span>
  </Link>
);

// Same avatar as /admin and /business (shared/core/ui.jsx); the website only resolves the image URL.
export const Avatar = ({ src, name, size }) => <BaseAvatar src={imgUrl(src)} name={name || "U"} size={size || 38} />;

export const Stars = ({ value = 0, size = 14, onPick }) => (
  <span className="stars" role={onPick ? "radiogroup" : undefined}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} size={size} fill={i <= Math.round(value) ? "currentColor" : "none"}
        style={onPick ? { cursor: "pointer" } : undefined} onClick={onPick ? () => onPick(i) : undefined} />
    ))}
  </span>
);

export const Modal = ({ open, onClose, children, wide }) => {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", h); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-lg" : ""}`} role="dialog" aria-modal="true">
        <button className="btn btn-ghost btn-icon modal-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        {children}
      </div>
    </div>
  );
};

export const Lightbox = ({ images, index, onClose }) => {
  const [i, setI] = useState(index || 0);
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => (x + 1) % images.length);
      if (e.key === "ArrowLeft") setI((x) => (x - 1 + images.length) % images.length);
    };
    document.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", h); document.body.style.overflow = ""; };
  }, [images.length, onClose]);
  return (
    <div className="lightbox">
      <div className="lightbox-top">
        <span className="tnum small">{i + 1} / {images.length}</span>
        <button className="btn btn-light btn-sm" onClick={onClose}><X size={16} /> Close</button>
      </div>
      <div className="lightbox-stage">
        <img src={images[i]} alt={"Photo " + (i + 1) + " of " + images.length} />
        {images.length > 1 && <>
          <button className="btn btn-icon nav-btn l" onClick={() => setI((x) => (x - 1 + images.length) % images.length)} aria-label="Previous"><ChevronLeft size={20} /></button>
          <button className="btn btn-icon nav-btn r" onClick={() => setI((x) => (x + 1) % images.length)} aria-label="Next"><ChevronRight size={20} /></button>
        </>}
      </div>
    </div>
  );
};

export const Pagination = ({ page, last, onChange }) => {
  if (!last || last <= 1) return null;
  const nums = [];
  for (let n = 1; n <= last; n++) if (n === 1 || n === last || Math.abs(n - page) <= 1) nums.push(n); else if (nums[nums.length - 1] !== "…") nums.push("…");
  return (
    <nav className="pager" aria-label="Pages">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
      {nums.map((n, k) => n === "…" ? <button key={k} disabled>…</button> : <button key={k} className={n === page ? "on" : ""} onClick={() => onChange(n)}>{n}</button>)}
      <button disabled={page >= last} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight size={18} /></button>
    </nav>
  );
};

// client-side paging for any list: const pg = usePaged(items, 12); … pg.items … <Paged pg={pg} />
export function usePaged(all, per = 12, resetKey = "") {
  const [page, setPage] = React.useState(1);
  const top = React.useRef(null);
  React.useEffect(() => setPage(1), [resetKey]);
  const list = all || [];
  const last = Math.max(1, Math.ceil(list.length / per));
  const cur = Math.min(page, last);
  const go = (n) => { setPage(n); const el = top.current; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: "smooth" }); };
  return { items: list.slice((cur - 1) * per, cur * per), page: cur, last, go, top, total: list.length };
}
export const Paged = ({ pg }) => <Pagination page={pg.page} last={pg.last} onChange={pg.go} />;

export const Empty = ({ icon: Icon = SearchX, title = "Nothing here yet", children }) => (
  <div className="empty"><Icon size={44} strokeWidth={1.2} /><h3>{title}</h3>{children && <p>{children}</p>}</div>
);

export const PageHead = ({ crumbs = [], kicker, title, children, right, narrow }) => (
  <header className="page-head">
    <div className={narrow ? "container narrow" : "container"}>
      {crumbs.length > 0 && (
        <div className="crumbs">
          <Link to="/">Home</Link>
          {crumbs.map((c, i) => <span key={i} className="row" style={{ gap: 8 }}><span>/</span>{c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}</span>)}
        </div>
      )}
      <div className="row between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1>{title}</h1>
          {children && <p>{children}</p>}
        </div>
        {right}
      </div>
    </div>
  </header>
);

export const SectionHead = ({ kicker, title, text, action }) => (
  <div className="section-head">
    <div className="stack">
      {kicker && <span className="kicker">{kicker}</span>}
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
    {action}
  </div>
);

// Same props as Confirm in shared/core/ui.jsx
export function Confirm({ open, onClose, onConfirm, title, children, confirmLabel = "Confirm" }) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <h3 style={{ paddingRight: 40 }}>{title}</h3>
        {children && <p className="small" style={{ color: "var(--text)" }}>{children}</p>}
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
