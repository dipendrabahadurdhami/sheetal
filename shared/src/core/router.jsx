// A small router for the three front-ends (no library).
// How it works: "history" mode for the real site (/, /business, /admin), "hash" mode for static previews.

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { config } from "./config";

const Ctx = createContext({ path: "/", navigate: () => {}, mode: "history" });
const read = (mode) => (mode === "hash" ? window.location.hash.slice(1) || "/" : window.location.pathname);

export function RouterProvider({ mode = "history", children }) {
  const [path, setPath] = useState(() => read(mode));
  useEffect(() => {
    const ev = mode === "hash" ? "hashchange" : "popstate";
    const on = () => setPath(read(mode));
    window.addEventListener(ev, on);
    return () => window.removeEventListener(ev, on);
  }, [mode]);
  const navigate = useCallback((to) => {
    // another app (website, /admin, /business): full page load
    if (config.owns && !config.owns(String(to).split(/[?#]/)[0])) { window.location.href = to; return; }
    if (mode === "hash") window.location.hash = to;
    else { window.history.pushState({}, "", to); setPath(to); window.dispatchEvent(new PopStateEvent("popstate")); }
    window.scrollTo(0, 0);
  }, [mode]);
  return <Ctx.Provider value={{ path: path.split("?")[0], navigate, mode }}>{children}</Ctx.Provider>;
}

export const useRouter = () => useContext(Ctx);

export function Link({ to, children, onClick, ...rest }) {
  const { navigate, mode } = useRouter();
  return (
    <a href={mode === "hash" ? `#${to}` : to} {...rest}
      onClick={(e) => { onClick?.(e); if (e.defaultPrevented || e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); }}>
      {children}
    </a>
  );
}

export function match(pattern, path) {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Routes({ routes, fallback = null }) {
  const { path } = useRouter();
  for (const r of routes) {
    const m = match(r.path, path);
    if (m) return r.render(m);
  }
  return fallback;
}
