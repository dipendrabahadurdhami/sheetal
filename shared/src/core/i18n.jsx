import React, { createContext, useContext, useMemo } from "react";
import en from "../i18n/en";
import ne from "../i18n/ne";
import enOps from "../i18n/en-ops";
import enAdmin from "../i18n/en-admin";
import enMore from "../i18n/en-more";
import enGrowth from "../i18n/en-growth";

const EN = { ...en, ...enOps, ...enAdmin, ...enMore, ...enGrowth };
const DICTS = { en: EN, ne };
export const LANGS = [
  { id: "en", label: "English", short: "EN" },
  { id: "ne", label: "नेपाली", short: "ने" },
];

const Ctx = createContext({ lang: "en", t: (k) => k });

export function I18nProvider({ lang = "en", children }) {
  const value = useMemo(() => {
    const d = DICTS[lang] || EN;
    const t = (key, vars) => {
      let s = d[key] ?? EN[key] ?? key;
      if (vars) for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
      return s;
    };
    return { lang, t };
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx).t;
export const useLang = () => useContext(Ctx).lang;
