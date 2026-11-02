// Keyboard navigation by section (website) with a "cloth" glide.
//
// Tab / Shift+Tab   next / previous section, centred below the sticky header
// Hold Tab          keeps pulling the page section by section, slower, like hand-over-hand
// Left / Right      cards inside the section (sliding rows follow)
// Enter             opens the focused card
//
// While the page glides, the content behaves like printed cloth being pulled: the edge under the
// header leads, the lower part lags, stretches slightly and tilts away, then settles with a soft
// spring when the pull stops. Only transform/opacity change per frame (GPU), and nothing reads
// layout inside the animation loop, so it stays smooth.
//
// We move focus ourselves (preventScroll) so the browser never runs a competing scroll of its own.
import "./cloth.css";

const HEAD = ".section-head, .pb-sec-head, h2";
const ROW = ".scroller, .pb-home-row, .hh-types, [data-hscroll]";
const CARD = ".pcard, .pb-card, .post-card, .loc-tile, .agent-card, .tool-tile, .card";
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SKIP = ".header, .menu, .modal, .overlay, .tabbar, .mega, [role='dialog'], .suggest, .hsearch-pop, .hx-pop";

// Feel. Change these to tune the motion.
const TAP_MS = [520, 950];      // short Tab: min / max glide time
const HOLD_MS = [1100, 1800];   // held Tab: min / max glide time per section
const TILT_DEG = 12;            // how far the hanging cloth leans away at full pull
const STRETCH = 0.06;           // vertical stretch at full pull (0.06 = 6%)
const SPRING = 0.10;            // spring stiffness (higher = snappier)
const DAMP = 0.2;               // spring damping (higher = less wobble)
const PLEAT_DEG = 12;           // "khumchinu": how deep the folds go when the cloth gathers
const GATHER = 0.10;            // how much sections bunch up while pulled (0.08 = 8% shorter)

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== "hidden";
const headerH = () => { const h = document.querySelector(".header"); return h ? h.getBoundingClientRect().height : 0; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function sections() {
  const all = [...document.querySelectorAll("main section")].filter((s) => visible(s) && s.querySelector(HEAD) && s.querySelector(FOCUSABLE));
  const top = all.filter((s) => !all.some((o) => o !== s && o.contains(s)));
  top.forEach((s) => {
    if (s.getAttribute("role")) return;
    const h = s.querySelector(HEAD); const label = h && (h.querySelector("h2") || h).textContent.trim();
    if (label) { s.setAttribute("role", "region"); s.setAttribute("aria-label", label); }
  });
  return top;
}
const items = (s) => [...s.querySelectorAll(FOCUSABLE)].filter((el) => visible(el) && !el.closest(".heart, .pb-heart, .pcard-nav"));
const firstCard = (s) => { const l = items(s); return l.find((el) => !el.closest(HEAD)) || l[0]; };
const allFocusable = () => [...document.querySelectorAll(FOCUSABLE)].filter((el) => visible(el) && !el.closest("[inert]") && el.tabIndex >= 0);

// Where the page should stop so the heading and cards sit in the middle below the header.
function targetTop(s, el) {
  const h = headerH(); const gap = 20; const space = window.innerHeight - h;
  const head = s.querySelector(HEAD); const card = el.closest(CARD) || el;
  const c = card.getBoundingClientRect();
  const row = (card.closest(ROW) || card.parentElement || card).getBoundingClientRect();
  const headTop = (head || card).getBoundingClientRect().top;
  const block = Math.max(c.bottom, Math.min(row.bottom, c.bottom + 400)) - headTop;
  let y;
  if (block <= space - gap * 2) y = headTop - h - (space - block) / 2;
  else if (c.bottom - headTop <= space - gap) y = headTop - h - gap;
  else y = c.top - h - (space - c.height) / 2;
  return Math.max(0, Math.round(window.scrollY + y));
}

// ── cloth ──
// The page is treated as a sheet of cloth made of horizontal bands (the blocks inside <main>).
// The band under the header is held and leads; each band further down lags a little more,
// tilts further away in 3D and stretches more, so the sheet curves like fabric being lifted.
// A travelling ripple runs down the sheet while it moves, and a light/shade overlay follows the curve.
const cloth = { d: 0, vd: 0, tension: 0, active: false, raf: 0, m: null, bands: [], hdr: 0, vh: 0, shade: null, t0: 0 };
function clothBegin() {
  if (reduced()) return;
  const m = document.querySelector("main"); if (!m) return;
  if (!cloth.shade) { const s = document.createElement("div"); s.className = "fs-cloth-shade"; s.setAttribute("aria-hidden", "true"); document.body.appendChild(s); cloth.shade = s; }
  if (!cloth.raf) {
    cloth.m = m; cloth.hdr = headerH(); cloth.vh = window.innerHeight; cloth.t0 = performance.now();
    const y0 = window.scrollY;
    // bands = direct blocks of the page; very tall ones are fine, they just bend as one piece
    cloth.bands = [...m.children].filter((el) => el.offsetHeight > 40).map((el, i) => {
      const r = el.getBoundingClientRect();
      const cards = [...el.querySelectorAll(CARD)].filter((c) => !c.parentElement.closest(CARD)).slice(0, 16);
      const lefts = [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)))].sort((a, b) => a - b);
      return { el, top: r.top + y0, h: r.height, i, cards: cards.map((c) => ({ el: c, col: lefts.indexOf(Math.round(c.getBoundingClientRect().left)) })) };
    });
    m.classList.add("fs-cloth");
  }
  cloth.active = true;
  if (!cloth.raf) cloth.raf = requestAnimationFrame(clothTick);
}
function clothReset() {
  cloth.bands.forEach((b) => { b.el.style.transform = ""; b.el.style.transformOrigin = ""; b.cards.forEach((c) => { c.el.style.transform = ""; c.el.style.transformOrigin = ""; }); });
  if (cloth.m) cloth.m.classList.remove("fs-cloth");
  if (cloth.shade) cloth.shade.style.opacity = "0";
  cloth.d = cloth.vd = cloth.tension = 0; cloth.raf = 0; cloth.bands = [];
}
function clothTick(now) {
  cloth.vd += (cloth.tension - cloth.d) * SPRING;
  cloth.vd *= 1 - DAMP;
  cloth.d += cloth.vd;
  const d = cloth.d;
  if (!cloth.active && Math.abs(d) < 0.002 && Math.abs(cloth.vd) < 0.002) { clothReset(); return; }
  const pull = window.scrollY + cloth.hdr;           // the held edge, just under the header
  const vh = cloth.vh; const t = (now - cloth.t0) / 1000;
  const ad = Math.abs(d); const dir = d >= 0 ? 1 : -1;
  const g = d * (cloth.dir || 1);                     // > 0 while pulled (gathering), < 0 in the settle (unfolding)
  for (const b of cloth.bands) {
    const mid = b.top + b.h / 2;
    const off = mid < pull - vh * 1.2 || mid > pull + vh * 2.2;
    if (off) { if (b.el.style.transform) { b.el.style.transform = ""; b.cards.forEach((c) => { c.el.style.transform = ""; }); } continue; }
    // 0 at the held edge, 1 one screen below it (negative above it)
    const n = clamp((mid - pull) / vh, -0.6, 1.8);
    const fall = dir > 0 ? Math.max(0, n) : Math.max(0, -n + 0.4);      // the side that hangs
    const ripple = Math.sin(t * 7 - n * 5.5) * ad * (0.35 + fall * 0.65); // travelling wave
    const pleat = (b.i % 2 ? 1 : -1) * g * PLEAT_DEG * (0.35 + fall);   // alternate bands fold in and out
    const lag = d * fall * 46 + ripple * 6;                              // px the band trails behind
    const tilt = -dir * ad * TILT_DEG * (0.25 + fall) - ripple * 2.2 + pleat;
    const scale = 1 - g * GATHER * (0.3 + fall) + ad * STRETCH * 0.25 * fall; // bunch up while pulled, spring open after
    b.el.style.transformOrigin = "50% " + (dir > 0 ? "0%" : "100%");
    b.el.style.transform = "perspective(1200px) translate3d(0," + lag.toFixed(2) + "px," + (-ad * fall * 40).toFixed(2) + "px) rotateX(" + tilt.toFixed(3) + "deg) scaleY(" + scale.toFixed(4) + ")";
    // the grid inside each band crumples too: neighbouring cards fold opposite ways, like gathered fabric
    for (const c of b.cards) {
      const s2 = c.col % 2 ? 1 : -1;
      const wave = Math.sin(t * 9 - c.col * 1.3 - n * 4) * ad;
      c.el.style.transformOrigin = "50% 50%";
      c.el.style.transform = "rotateY(" + (s2 * g * PLEAT_DEG * 0.8 * (0.4 + fall) + wave * 3).toFixed(3) + "deg) rotateX(" + (wave * 4 * (0.3 + fall)).toFixed(3) + "deg) scale(" + (1 - Math.abs(g) * 0.035 * (0.4 + fall)).toFixed(4) + ")";
    }
  }
  cloth.shade.style.opacity = Math.min(1, ad * 1.2).toFixed(3);
  cloth.shade.dataset.dir = dir > 0 ? "down" : "up";
  cloth.raf = requestAnimationFrame(clothTick);
}
const clothEnd = () => { cloth.tension = 0; cloth.active = false; };

// ── glide (one rAF loop drives scroll and cloth together) ──
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
let glide = null;
function glideTo(y, dur, done) {
  if (glide) glide.stop = true;
  const from = window.scrollY;
  if (reduced() || Math.abs(y - from) < 2) { window.scrollTo(0, y); done && done(); return; }
  const html = document.documentElement; const prev = [html.style.scrollSnapType, html.style.scrollBehavior];
  html.style.scrollSnapType = "none"; html.style.scrollBehavior = "auto";
  clothBegin(); cloth.dir = y > from ? 1 : -1;
  const job = { stop: false }; glide = job;
  const t0 = performance.now(); let lastY = from; let lastT = t0;
  const avg = Math.max(4, (Math.abs(y - from) / dur) * 16 * 1.4);   // px per frame that counts as a full pull
  const step = (now) => {
    if (job.stop) return;
    const p = clamp((now - t0) / dur, 0, 1);
    const cur = from + (y - from) * easeInOut(p);
    window.scrollTo(0, cur);
    const dt = Math.max(1, now - lastT);
    cloth.tension = clamp(((cur - lastY) / dt) * 16 / avg, -1, 1);   // full pull mid-glide at any speed
    lastY = cur; lastT = now;
    if (p < 1) { requestAnimationFrame(step); return; }
    glide = null; html.style.scrollSnapType = prev[0]; html.style.scrollBehavior = prev[1];
    done && done();
  };
  requestAnimationFrame(step);
}
function slideRow(el, dur) {
  const row = el.closest(ROW); if (!row || row.scrollWidth <= row.clientWidth) return;
  const rr = row.getBoundingClientRect(); const r = (el.closest(CARD) || el).getBoundingClientRect();
  const from = row.scrollLeft; const to = from + (r.left - rr.left) - (rr.width - r.width) / 2;
  if (reduced()) { row.scrollLeft = to; return; }
  const t0 = performance.now();
  const step = (now) => { const p = clamp((now - t0) / dur, 0, 1); row.scrollLeft = from + (to - from) * easeInOut(p); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function go(s, el, opts = {}) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const y = targetTop(s, el); const dist = Math.abs(y - window.scrollY);
  const [lo, hi] = opts.held ? HOLD_MS : TAP_MS;
  const dur = clamp(lo + dist * (opts.held ? 0.45 : 0.3), lo, hi);
  slideRow(el, Math.min(dur, 700));
  glideTo(y, dur, () => { if (!opts.keepPull) clothEnd(); opts.done && opts.done(); });
}

// ── keys ──
let byKey = false, ours = false, tabHeld = false, busy = false, pressAt = 0;
document.addEventListener("pointerdown", () => { byKey = false; }, true);
document.addEventListener("keyup", (e) => { if (e.key === "Tab") { tabHeld = false; if (!busy) clothEnd(); } }, true);
window.addEventListener("blur", () => { tabHeld = false; clothEnd(); });

function jump(list, i, back, held) {
  const j = i + (back ? -1 : 1);
  if (j < 0 || j >= list.length) { clothEnd(); return false; }
  busy = true; ours = true;
  go(list[j], firstCard(list[j]), { held, keepPull: held && tabHeld, done: () => {
    busy = false;
    if (!tabHeld) { clothEnd(); return; }
    requestAnimationFrame(() => {                       // still holding: keep pulling, no pause
      if (!tabHeld) { clothEnd(); return; }
      const l = sections(); const k = l.findIndex((x) => x.contains(document.activeElement));
      if (k >= 0) jump(l, k, back, true); else clothEnd();
    });
  } });
  ours = false;
  return true;
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const a = document.activeElement;
  if (e.key === "Tab") { byKey = true; if (!e.repeat) { tabHeld = true; pressAt = performance.now(); } }
  if (a && a !== document.body && (a.closest(SKIP) || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && e.key !== "Tab") return;
  const list = sections(); if (!list.length) return;
  const i = a ? list.findIndex((s) => s.contains(a)) : -1;

  if (e.key === "Tab") {
    if (i >= 0) {
      if (busy) { e.preventDefault(); return; }                        // held: the current pull continues on its own
      const back = e.shiftKey; const j = i + (back ? -1 : 1);
      if (j < 0 || j >= list.length) { const edge = back ? items(list[i])[0] : items(list[i]).at(-1); if (edge && edge !== a) edge.focus({ preventScroll: true }); return; }
      e.preventDefault();
      jump(list, i, back, e.repeat || performance.now() - pressAt > 350);
      return;
    }
    if (!a || a === document.body || (a.closest(SKIP) && !a.closest(".header"))) return;
    const f = allFocusable(); const k = f.indexOf(a); if (k < 0) return;
    const next = f[k + (e.shiftKey ? -1 : 1)]; if (!next) return;
    const s = list.find((x) => x.contains(next)); if (!s) return;     // next stop is not in a section: normal Tab
    e.preventDefault(); busy = true; ours = true;
    go(s, e.shiftKey ? (items(s).at(-1) || next) : firstCard(s), { done: () => { busy = false; } });
    ours = false;
    return;
  }
  if (i < 0 || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;  // arrows: cards inside the section
  const its = items(list[i]); const k = its.indexOf(a); if (k < 0) return;
  const n = its[k + (e.key === "ArrowRight" ? 1 : -1)]; if (!n) return;
  e.preventDefault(); ours = true;
  n.focus({ preventScroll: true }); slideRow(n, 520);
  const y = targetTop(list[i], n); if (Math.abs(y - window.scrollY) > 4) glideTo(y, 480, clothEnd);
  ours = false;
}, true);

// Only when the browser chose the target (Tab right after clicking the page): let its scroll finish, then glide into place.
document.addEventListener("focusin", (e) => {
  if (ours || !byKey || !(e.target instanceof Element) || e.target.closest(SKIP)) return;
  const s = sections().find((x) => x.contains(e.target)); if (!s) return;
  setTimeout(() => { if (!busy) go(s, e.target); }, 380);
});

// Page-wide listeners: reload the whole page when this file changes so old copies don't stay active.
if (import.meta.hot) import.meta.hot.decline();
