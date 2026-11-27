// Languages (English and Nepali): the language switch and the t() function for screen text.
// Where it fits: every screen uses useT(); the language button in the top bar switches.
// How it works: texts live in shared/src/i18n; a key missing in Nepali falls back to English. With a business type (the business panel),
// that type's own words come first (i18n/type-words.js: rooms and guests for a hotel, properties and clients for an agency…).

import React, { createContext, useContext, useMemo } from "react";
import en from "../i18n/en";
import ne from "../i18n/ne";
import enOps from "../i18n/en-ops";
import enAdmin from "../i18n/en-admin";
import enMore from "../i18n/en-more";
import enGrowth from "../i18n/en-growth";
import enMarket from "../i18n/en-market";
import neMarket from "../i18n/ne-market";
import { TYPE_WORDS } from "../i18n/type-words";

const EN = { ...en, ...enOps, ...enAdmin, ...enMore, ...enGrowth, ...enMarket };
const DICTS = { en: EN, ne: { ...ne, ...neMarket } };
export const LANGS = [
  { id: "en", label: "English", short: "EN" },
  { id: "ne", label: "नेपाली", short: "ने" },
];

const Ctx = createContext({ lang: "en", t: (k) => k });

export function I18nProvider({ lang = "en", type = null, children }) {
  const value = useMemo(() => {
    const d = DICTS[lang] || EN;
    const own = (type && TYPE_WORDS[type]) || null;
    const t = (key, vars) => {
      // The type's word in this language, the normal word in this language, then English (the type's, then the normal one).
      let s = own?.[lang]?.[key] ?? d[key] ?? own?.en?.[key] ?? EN[key] ?? key;
      if (vars) for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
      return s;
    };
    return { lang, type, t };
  }, [lang, type]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx).t;
export const useLang = () => useContext(Ctx).lang;
