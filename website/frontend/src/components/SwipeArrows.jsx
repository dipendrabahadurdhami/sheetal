// The animated arrow on the home page dial: it follows the ring and stretches with the spin speed.
// How it works: the parent calls apiRef.current(spanDegrees, dir) every frame; the paths are updated directly.

import { useEffect, useRef } from "react";

const CSS = `
.rg-arrow-arc{position:absolute;left:0;top:0;pointer-events:none;z-index:2;transition:opacity .25s;filter:drop-shadow(0 6px 10px rgba(234,34,41,.22))}
.rg-arrow-arc.hide{opacity:0}
.rg-arrow-arc .sa-head{transition:opacity .2s}
[data-theme~="red"] .rg-arrow-arc{--sa-end:#ffd9da;--sa-mid:#ffffff;filter:drop-shadow(0 2px 8px rgba(0,0,0,.28))}
`;

export const ARROW_MIN = 28, ARROW_MAX = 90;                   // degrees each side of the top (the real cap is lower: see maxSpan)
const HEAD = 24, RA = (R) => R - 124;                          // head length, arrow circle radius
// the largest span at which the head tip lands exactly on the footer edge: ra*cos(a) = HEAD*sin(a)
const maxSpan = (R) => (Math.atan(RA(R) / HEAD) * 180) / Math.PI;

// side = which end carries the head (1 right, -1 left); mix = 0 symmetric (both heads) .. 1 comet (one head, sharp tail)
function build(g, spanDeg, side = 1, mix = 0) {
  const { cx, cy, R } = g;
  const ra = RA(R);                                             // just inside the scale numbers, clear of them
  const span = (spanDeg * Math.PI) / 180;
  const pt = (r, th) => [cx + r * Math.sin(th), cy - 1 - r * Math.cos(th)];
  const f = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  const N = 48, outer = [], inn = [];
  for (let i = -N; i <= N; i++) {
    const x = i / N, th = x * span;
    const sym = 2.5 + 3 * Math.cos(Math.abs(x) * (Math.PI / 2));          // slim, slightly fuller middle
    const p = (x * side + 1) / 2;                                          // 0 at the tail, 1 at the head
    const comet = 0.2 + 6.2 * Math.pow(p, 1.25);                           // needle-sharp tail, full weight where the head sits
    const t = sym + (comet - sym) * mix;
    outer.push(pt(ra + t / 2, th)); inn.push(pt(ra - t / 2, th));
  }
  const body = `M${outer.map(f).join(" L")} L${inn.reverse().map(f).join(" L")} Z`;
  const head = (s) => {
    const th = s * span, B = pt(ra, th), T = [s * Math.cos(span), Math.sin(span)], Nn = [Math.sin(th), -Math.cos(th)];
    const back = 3;                                                        // base tucked back into the body so there is never a gap
    const A = [B[0] - back * T[0], B[1] - back * T[1]];
    const tip = [B[0] + HEAD * T[0], B[1] + HEAD * T[1]];
    return `M${f([A[0] + 11 * Nn[0], A[1] + 11 * Nn[1]])} L${f(tip)} L${f([A[0] - 11 * Nn[0], A[1] - 11 * Nn[1]])} Z`;
  };
  return { ra, body, hr: head(1), hl: head(-1) };
}

export function SwipeArrows({ g, hide, apiRef }) {
  const body = useRef(null), hr = useRef(null), hl = useRef(null);
  const gRef = useRef(g);
  const mixRef = useRef(0), sideRef = useRef(1);
  gRef.current = g;
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = (spanDeg, dir = 0) => {
      const gg = gRef.current; if (!gg || gg.m || !body.current) return;
      if (dir) sideRef.current = dir;
      mixRef.current += ((dir ? 1 : 0) - mixRef.current) * 0.18;             // eases between the two shapes
      const b = build(gg, Math.max(ARROW_MIN, Math.min(ARROW_MAX, maxSpan(gg.R), spanDeg)), sideRef.current, mixRef.current);
      body.current.setAttribute("d", b.body);
      hr.current.setAttribute("d", b.hr); hl.current.setAttribute("d", b.hl);
      hr.current.style.opacity = dir < 0 ? 0 : 1;               // arrow points left  -> hide the right head
      hl.current.style.opacity = dir > 0 ? 0 : 1;               // arrow points right -> hide the left head
    };
    return () => { apiRef.current = null; };
  }, [apiRef]);
  if (!g || g.m) return null;                                   // desktop only: the mobile circle is too small
  const b = build(g, ARROW_MIN);
  return (
    <>
      <style>{CSS}</style>
      <svg className={`rg-arrow-arc ${hide ? "hide" : ""}`} width={g.w} height={g.cy} viewBox={`0 0 ${g.w} ${g.cy}`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="sa-grad" gradientUnits="userSpaceOnUse" x1={g.cx - b.ra} y1="0" x2={g.cx + b.ra} y2="0">
            <stop offset="0" style={{ stopColor: "var(--sa-end, var(--c-crimson, #9E1B20))" }} />
            <stop offset=".5" style={{ stopColor: "var(--sa-mid, var(--c-red, #EA2229))" }} />
            <stop offset="1" style={{ stopColor: "var(--sa-end, var(--c-crimson, #9E1B20))" }} />
          </linearGradient>
        </defs>
        <g fill="url(#sa-grad)" stroke="url(#sa-grad)" strokeWidth="1.2" strokeLinejoin="round">
          <path ref={body} d={b.body} />
          <path ref={hr} className="sa-head" d={b.hr} />
          <path ref={hl} className="sa-head" d={b.hl} />
        </g>
      </svg>
    </>
  );
}