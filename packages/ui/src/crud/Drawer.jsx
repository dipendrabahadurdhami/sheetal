// Drawer with the extras: sizes, "discard your changes?", a block while saving, and a focus trap.
// Sizes are classes in platform.css: pf-drawer-sm (360 px), default (today's width, 560 px), pf-drawer-lg (640 px).
// Where it fits: CrudPage's form drawer. The plain Drawer in primitives.jsx is unchanged and screens keep using it; this one is new.
// How it works: same markup and classes as the plain Drawer. size "sm" 360, "md" (default, today's width), "lg" 640 px. While `dirty`, Esc / the
// background / the close button ask first. While `busy`, nothing closes it. Focus moves into the drawer when it opens, Tab stays inside,
// and focus goes back to whatever opened it when it closes.
// Rules: a behaviour improvement, not a visual change. A screen reader still sees role="dialog" aria-modal="true".

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { Confirm, IconButton } from "../primitives.jsx";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Drawer({ open, onClose, title, sub, children, footer, size = "md", dirty = false, busy = false, initialFocus = "first-field" }) {
  const t = useT();
  const ref = useRef(null);
  const [ask, setAsk] = useState(false);
  const askRef = useRef(false);
  askRef.current = ask;

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) setAsk(true); else onClose();
  }, [busy, dirty, onClose]);

  // Esc. When the "discard?" question is open, Esc belongs to it (the Confirm closes itself).
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (e.key === "Escape" && !askRef.current) requestClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, requestClose]);

  // Focus in on open, back to the opener on close.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const box = ref.current;
    const target = initialFocus === "first-field" ? box?.querySelector(".pf-drawer-body input:not([type=hidden]):not([disabled]),.pf-drawer-body select,.pf-drawer-body textarea") : null;
    (target || box?.querySelector(FOCUSABLE) || box)?.focus?.();
    return () => { if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus(); };
  }, [open]);

  const trap = (e) => {
    if (e.key !== "Tab") return;
    const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  if (!open) return null;
  return (
    <>
      <div className="pf-scrim" onClick={requestClose} />
      <aside ref={ref} className={`pf-drawer${size === "sm" ? " pf-drawer-sm" : size === "lg" ? " pf-drawer-lg" : ""}`} role="dialog" aria-modal="true" aria-label={title} aria-busy={busy || undefined} tabIndex={-1} onKeyDown={trap}>
        <div className="pf-drawer-head">
          <div><h3>{title}</h3>{sub && <span className="small muted">{sub}</span>}</div>
          <IconButton icon="x" label={t("common.close")} onClick={requestClose} disabled={busy} />
        </div>
        <div className="pf-drawer-body">{children}</div>
        {footer && <div className="pf-drawer-foot">{footer}</div>}
      </aside>
      <Confirm open={ask} onClose={() => setAsk(false)} onConfirm={onClose} danger title={t("kit.discardTitle")} confirmLabel={t("kit.discard")}>
        {t("kit.discardText")}
      </Confirm>
    </>
  );
}

