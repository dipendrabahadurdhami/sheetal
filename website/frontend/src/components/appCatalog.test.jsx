// Build-time checks for the website's Apps and Pricing pages (P3-FE-5): the real public catalog (the seed catalog through publicCatalog(), the
// same function GET /v1/public/catalog answers with) is rendered to HTML, and (1) every price shown equals the catalog's number, (2) the HTML
// never says "verified", never shows a PAN and never names the company behind the technology, (3) Start free is there for live apps only.
// Where it fits: the root front-end test run (npx vitest run website/frontend).
import { describe, expect, it } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { publicCatalog, seedCatalog } from "../../../../platform/src/billing/catalog.ts";
import { AppCard, EditionsTable, PricingTable, fromPrice, monthsSaved, rsPaisa } from "./AppCatalog.jsx";

const CATALOG = JSON.parse(JSON.stringify(publicCatalog(seedCatalog()))); // exactly the JSON shape the API sends
const render = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const shown = (html) => [...html.matchAll(/data-paisa="(\d*)"[^>]*>([^<]*)/g)].filter(([, p]) => p !== "").map(([, p, text]) => [Number(p), text]);
const FORBIDDEN = [/verif/i, /प्रमाणित/, /\bPAN\b/, /DhamiPlus/i, /technology partner/i, /publisher share/i];
const noop = () => {};

const pages = {
  cards: render(<>{CATALOG.apps.map((a) => <AppCard key={a.id} app={a} onStart={noop} />)}</>),
  editions: render(<>{CATALOG.apps.map((a) => <EditionsTable key={a.id} app={a} />)}</>),
  pricing: render(<PricingTable catalog={CATALOG} onStart={noop} />),
};

describe("prices equal the API", () => {
  it("every amount on every page is a catalog number, formatted from paisa", () => {
    const all = new Set([
      ...CATALOG.apps.flatMap((a) => a.editions.flatMap((e) => [e.priceMonthPaisa, e.priceYearPaisa])),
      CATALOG.business.seatAddon.priceMonthPaisa, ...CATALOG.addons.map((x) => x.priceMonthPaisa), 0,
    ]);
    for (const [name, html] of Object.entries(pages)) {
      const list = shown(html);
      expect(list.length, name).toBeGreaterThan(0);
      for (const [p, text] of list) {
        expect(all.has(p), `${name}: ${p}`).toBe(true);
        expect(text.includes(rsPaisa(p)) || text === "Free", `${name}: ${text}`).toBe(true);
      }
    }
  });
  it("the cards' 'from' price is the cheapest paid month; yearly saving from the two prices", () => {
    const hotel = CATALOG.apps.find((a) => a.id === "hotel");
    expect(fromPrice(hotel)).toBe(Math.min(...hotel.editions.filter((e) => !e.free).map((e) => e.priceMonthPaisa)));
    const full = hotel.editions.find((e) => !e.free);
    expect(monthsSaved(full)).toBe(2); // yearly = 10 months (the owner's answer 5)
    expect(pages.editions).toContain("You save 2 months");
  });
});

describe("public words", () => {
  it("never verified, never a PAN, never the company behind the technology", () => {
    const sources = ["./AppCatalog.jsx", "../pages/Apps.jsx", "../pages/Pricing.jsx"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"));
    for (const [name, html] of [...Object.entries(pages), ...sources.map((s, i) => [`source ${i}`, s])]) {
      for (const re of FORBIDDEN) expect(html, `${name} ${re}`).not.toMatch(re);
    }
  });
  it("only public catalog fields reach the page (no partner share, no internal limits behaviour)", () => {
    const json = JSON.stringify(CATALOG);
    expect(json).not.toMatch(/partner|commission|behaviour|softOverPct/);
  });
});

describe("Start free and SEO", () => {
  it("live apps have Start free; coming-soon apps don't", () => {
    for (const a of CATALOG.apps) {
      const html = render(<AppCard app={a} onStart={noop} />);
      expect(html.includes("Start free"), a.id).toBe(a.availability !== "coming_soon");
    }
  });
  it("each page sets its own title and description, and the routes exist", () => {
    for (const f of ["../pages/Apps.jsx", "../pages/Pricing.jsx"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).toMatch(/useSEO\("[^"]+", "[^"]{40,}"/);
    const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
    for (const r of ['path="/apps"', 'path="/apps/:id"', 'path="/pricing"', 'path="/plans"']) expect(app).toContain(r);
  });
  it("Start free signs in first, then opens the business marketplace the API names", () => {
    const s = readFileSync(new URL("./AppCatalog.jsx", import.meta.url), "utf8");
    expect(s).toContain('if (!user) { pending.current = appId ?? null; setAuth("login"); return; }');
    expect(s).toContain('window.location.assign(r?.data?.link || "/business/marketplace")');
  });
});
