// GET /v1/public/catalog (P3-BE-1): the marketplace's apps, editions and prices, public, from the platform.catalog setting.
// Where it fits: runs with the website API tests (throwaway PostgreSQL from platform/test/setup-db.ts): npm run test -w @sheetal/website-api
// Rules checked: no sign-in needed; prices are the seed's until staff save a catalog, then the saved one; a release's new apps are added to a saved
// catalog without changing it; the answer never carries the words "verified", PAN, the technology company's name or internal fields.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { CATALOG_SETTING, seedCatalog } from "@sheetal/platform/billing/catalog";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const get = () => app.inject({ method: "GET", url: "/v1/public/catalog", headers: { "user-agent": "Mozilla/5.0 Chrome/130" } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), API_URL: "https://api.test" }));
  await app.db!.appSetting.deleteMany({ where: { key: CATALOG_SETTING.key } });
});
afterAll(async () => {
  await app.db!.appSetting.deleteMany({ where: { key: CATALOG_SETTING.key } });
  await app.close();
});

describe("the public catalog", () => {
  it("answers without a sign-in with the seed prices (VAT included, yearly = 10 months)", async () => {
    const r = await get();
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, max-age=300");
    const d = r.json().data;
    expect(d.vatIncluded).toBe(true);
    const hotel = d.apps.find((a: { id: string }) => a.id === "hotel");
    expect(hotel).toMatchObject({ availability: "live", trialDays: 14, freeEdition: true, name: { en: "Hotel PMS" } });
    expect(hotel.editions.map((e: { id: string; priceMonthPaisa: number; priceYearPaisa: number; limits: object }) => [e.id, e.priceMonthPaisa, e.priceYearPaisa, e.limits]))
      .toEqual([["free", 0, 0, { rooms: 5 }], ["full", 70_000, 700_000, { rooms: 40 }]]);
    expect(d.apps.find((a: { id: string }) => a.id === "payroll")).toMatchObject({ availability: "coming_soon", freeEdition: false });
    expect(d.apps.some((a: { id: string }) => a.id === "workspace")).toBe(false); // the always-on workspace is never sold
    expect(d.business.freeSeats).toBe(2);
  });

  it("never shows 'verified', PAN, the technology company or internal fields", async () => {
    const text = JSON.stringify((await get()).json());
    expect(text).not.toMatch(/verif/i);
    expect(text).not.toMatch(/\bpan\b/i);
    expect(text).not.toMatch(/dhamiplus/i);
    expect(text).not.toMatch(/partner|commission|revenue|version|visible|behaviour|needsPaidEdition/i);
  });

  it("shows a saved catalog, with the apps a newer release adds filled in", async () => {
    const saved = seedCatalog();
    saved.version = 2;
    saved.apps.hotel!.editions.full!.priceMonthPaisa = 65_000;
    saved.apps.crm!.visible = false;
    delete saved.apps.reviews; // as if saved before Reviews existed
    await app.db!.appSetting.create({ data: { key: CATALOG_SETTING.key, value: saved as never } });
    // A fresh app (a fresh settings cache) reads the saved row.
    await app.close();
    app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), API_URL: "https://api.test" }));
    const d = (await get()).json().data;
    expect(d.apps.find((a: { id: string }) => a.id === "hotel").editions[1].priceMonthPaisa).toBe(65_000);
    expect(d.apps.some((a: { id: string }) => a.id === "crm")).toBe(false);
    expect(d.apps.find((a: { id: string }) => a.id === "reviews").editions[1].priceMonthPaisa).toBe(15_000);
  });
});
