// Website-wide state: the signed-in person, sign-in modal, theme, toasts and saved preferences.
// How it works: follows theme changes made in other tabs and in embedded pages.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/endpoints";
import { toItem, toList } from "../api/client";
import { normaliseTheme, storedTheme, useSharedTheme } from "@sheetal/shared/core/theme";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [theme, setTheme] = useState(storedTheme);
  const [user, setUser] = useState(null);
  const [favs, setFavs] = useState(() => new Set());
  const [auth, setAuth] = useState(null); // null | "login" | "register" | "forgot"
  const [toasts, setToasts] = useState([]);

  // follows changes made inside embedded platform pages (e.g. My profile → Theme) and other tabs
  useSharedTheme(theme, setTheme);

  const toast = useCallback((msg) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const loadUser = useCallback(async () => {
    if (!localStorage.getItem("sheetal_token")) return;
    try {
      const u = toItem(await api.me());
      setUser(u);
    } catch {
      setUser(null);
      return;
    }
    // Saved listings load separately: if they fail, the person stays logged in.
    try {
      const f = toList(await api.favourites());
      setFavs(new Set(f.items.map((x) => Number(x.property_id ?? x.property?.id ?? x.id))));
    } catch {
      setFavs(new Set());
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => {
    const h = () => { setUser(null); setFavs(new Set()); };
    window.addEventListener("sheetal:logout", h);
    return () => window.removeEventListener("sheetal:logout", h);
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api.login(email, password);
    const data = res?.data || res;
    const token = data?.token || res?.token || res?.access_token;
    if (!token) throw new Error(res?.message || "Login failed");
    localStorage.setItem("sheetal_token", token);
    await loadUser();
    setAuth(null);
    toast(`Welcome back${data?.user_name ? ", " + data.user_name : ""}.`);
  }, [loadUser, toast]);

  const logout = useCallback(() => {
    api.logout().catch(() => {}); // end the session on the server too
    localStorage.removeItem("sheetal_token");
    setUser(null);
    setFavs(new Set());
    toast("You are logged out.");
  }, [toast]);

  const toggleFav = useCallback(async (id) => {
    id = Number(id);
    if (!user) { setAuth("login"); return; }
    const had = favs.has(id);
    setFavs((s) => { const n = new Set(s); had ? n.delete(id) : n.add(id); return n; });
    try {
      had ? await api.removeFav(id) : await api.addFav(id);
      toast(had ? "Removed from saved" : "Saved to your list");
    } catch {
      setFavs((s) => { const n = new Set(s); had ? n.add(id) : n.delete(id); return n; });
      toast("Could not update saved list");
    }
  }, [user, favs, toast]);

  const value = useMemo(() => ({
    theme, toggleTheme: () => setTheme((t) => (t === "light" ? "dark" : t === "dark" ? "red" : "light")), setTheme: (v) => setTheme(normaliseTheme(v)),
    user, setUser, loadUser, login, logout, favs, toggleFav, auth, setAuth, toast,
  }), [theme, user, loadUser, login, logout, favs, toggleFav, auth, toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}</div>
    </Ctx.Provider>
  );
}
