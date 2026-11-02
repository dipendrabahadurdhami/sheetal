import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

// Custom dropdown — replaces the browser's native <select> list.
// options: [[value, label], ...]
export function Dropdown({ value, options, onChange, placeholder = "Select", bare, id, align = "left" }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const ref = useRef(null);
  const cur = options.find(([v]) => String(v) === String(value));

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current?.contains(e.target)) return;
      // inside the search bar, opening another field keeps this one open
      if (ref.current?.closest(".search") && e.target.closest?.(".search")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  useEffect(() => { if (open) setHi(Math.max(0, options.findIndex(([v]) => String(v) === String(value)))); }, [open]);  

  const pick = (v) => { onChange(v); setOpen(false); };
  const onKey = (e) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown") { e.preventDefault(); open ? setHi((h) => Math.min(options.length - 1, h + 1)) : setOpen(true); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    if (e.key === "Enter" && open && hi >= 0) { e.preventDefault(); pick(options[hi][0]); }
  };

  return (
    <div className={`dd ${bare ? "dd-bare" : ""} ${open ? "open" : ""}`} ref={ref}>
      <button type="button" id={id} className="dd-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} onKeyDown={onKey}>
        <span className={cur ? "" : "muted"}>{cur ? cur[1] : placeholder}</span>
        <ChevronDown size={16} className="dd-chev" />
      </button>
      {open && (
        <ul className={`dd-menu ${align === "right" ? "right" : ""}`} role="listbox">
          {options.map(([v, l], i) => {
            const on = String(v) === String(value);
            return (
              <li key={String(v)} role="option" aria-selected={on} className={`${on ? "on" : ""} ${i === hi ? "hi" : ""}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(v); }}>
                <span>{l}</span>{on && <Check size={15} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
