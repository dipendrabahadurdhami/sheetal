// Each business type's own words (i18n/type-words.js) through I18nProvider: the type's word first, in the chosen language; the normal word
// for everything not listed; never English when a Nepali word exists.
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, useT } from "./i18n";
import { TYPE_WORDS } from "../i18n/type-words";
import en from "../i18n/en";

const Show = ({ k }) => <>{useT()(k)}</>;
const say = (k, o = {}) => renderToStaticMarkup(<I18nProvider lang={o.lang || "en"} type={o.type ?? null}><Show k={k} /></I18nProvider>);

describe("business-type words", () => {
  it("each type says its own words; no type keeps the normal ones", () => {
    expect(say("nav.listings")).toBe(en["nav.listings"]);
    expect(say("nav.listings", { type: "hotel" })).toBe("Rooms and listings");
    expect(say("nav.listings", { type: "agency" })).toBe("Properties");
    expect(say("nav.collections", { type: "developer" })).toBe("Instalments");
    expect(say("nav.inbox", { type: "sponsor" })).toBe("Investor enquiries");
    expect(say("nav.team", { type: "hotel" })).toBe(en["nav.team"]); // not listed: the normal word
  });

  it("speaks Nepali in Nepali", () => {
    expect(say("nav.bookings", { type: "hotel", lang: "ne" })).toBe("आरक्षण");
    expect(say("nav.listings", { type: "agency", lang: "ne" })).toBe("सम्पत्तिहरू");
  });

  it("every type has both languages with the same words listed, and only keys that exist", () => {
    for (const [type, langs] of Object.entries(TYPE_WORDS)) {
      expect(Object.keys(langs.ne).sort(), type).toEqual(Object.keys(langs.en).sort());
      for (const k of Object.keys(langs.en)) expect(say(k), `${type} ${k}`).not.toBe(k); // a real key with a normal word
    }
  });
});
