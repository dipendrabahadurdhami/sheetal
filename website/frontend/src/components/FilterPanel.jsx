// Filter sidebar pieces shared by every search page: collapsible groups with radio and checkbox options, price range.

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

export function useGroups(initial) {
  const [open, setOpen] = useState(initial);
  return { isOpen: (id) => open.includes(id), toggle: (id) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id])) };
}

export function FGroup({ label, count = 0, open, onToggle, children }) {
  return (
    <div className={`fx-g ${open ? "open" : ""}`}>
      <button type="button" className="fx-head" aria-expanded={open} onClick={onToggle}>
        <span>{label}</span>
        {count > 0 && <b className="fx-count tnum">{count}</b>}
        <ChevronRight size={16} className="fx-chev" />
      </button>
      <div className="fx-body" {...(!open && { inert: "" })}><div className="fx-inner">{children}</div></div>
    </div>
  );
}

// options: [[value, label]]. Single choice uses radios; multi uses checkboxes (value is an array).
export function Opts({ options, value, multi = false, onPick }) {
  return (
    <div className="fx-opts" role={multi ? "group" : "radiogroup"}>
      {options.map(([v, l]) => {
        const on = multi ? value.includes(v) : (value || "") === v;
        return (
          <button key={v || "any"} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on} className={`fx-opt ${multi ? "is-check" : ""} ${on ? "on" : ""}`} onClick={() => onPick(v)}>
            <i className="fx-mark" aria-hidden="true" /><span>{l}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PriceRange({ min, max, onMin, onMax }) {
  return (
    <div className="fx-range">
      <label><small>Min</small><input className="input tnum" type="number" inputMode="numeric" placeholder="0" defaultValue={min || ""} onBlur={(e) => onMin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onMin(e.currentTarget.value)} /></label>
      <span className="fx-dash" aria-hidden="true" />
      <label><small>Max</small><input className="input tnum" type="number" inputMode="numeric" placeholder="Any" defaultValue={max || ""} onBlur={(e) => onMax(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onMax(e.currentTarget.value)} /></label>
    </div>
  );
}

// Scroll area for the filter groups: scrolls on its own, edges fade when there is more above or below.
export function FScroll({ children }) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const check = () => setEdge({ top: el.scrollTop > 2, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 2 });
    // The panel always ends inside the screen: before it sticks (page at the top) it is shorter, so the bottom and the fade stay visible.
    const aside = el.closest(".filters");
    const fit = () => {
      if (!aside || !window.matchMedia("(min-width: 1081px)").matches) { if (aside) aside.style.maxHeight = ""; check(); return; }
      // Stays pinned under the header; near the end of the page it gets shorter instead of being pushed up by the footer.
      const top = Math.max(aside.getBoundingClientRect().top, parseFloat(getComputedStyle(aside).top) || 0);
      const layout = aside.closest(".listing-layout");
      const end = Math.min(window.innerHeight - 16, layout ? layout.getBoundingClientRect().bottom - 8 : window.innerHeight - 16);
      aside.style.setProperty("max-height", `${Math.max(160, end - top)}px`, "important");
      check();
    };
    fit();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("scroll", fit, { passive: true });
    const ro = new ResizeObserver(check); ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", fit);
    return () => { el.removeEventListener("scroll", check); window.removeEventListener("scroll", fit); ro.disconnect(); window.removeEventListener("resize", fit); };
  }, []);
  return <div ref={ref} className={`fx-scroll ${edge.top ? "fade-top" : ""} ${edge.bottom ? "fade-bottom" : ""}`}><div className="fx-scroll-in">{children}</div></div>;
}
