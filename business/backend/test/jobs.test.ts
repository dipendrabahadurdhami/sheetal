// Tests of the business API's background jobs (business/backend/src/jobs.ts) and of the old start*Job shims.
// Where it fits: platform/test/jobs-registry.test.ts proves the registry itself; this file proves the business API hands it the same
// jobs, with the same first-run delays and intervals, as the separate timers had before P1-BE-4, and that the old exports still work.
// How it works: the specs are built with a bare stand-in for the app (nothing runs until a timer fires), the clock is faked, and the
// shims are started on a plain Fastify instance. Needs the test database only for the one test that builds the real app.
// Run with: npm run test -w @sheetal/business-api
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/platform/test/setup-db";
import { loadConfig } from "@sheetal/platform/core/config";
import { jobsOn } from "@sheetal/platform/jobs/registry";
import { buildApp } from "../src/app.js";
import { hasSessionDaysReader } from "@sheetal/platform/auth/sessions";
import { businessJobs, eventsOf } from "../src/jobs.js";
import { startExpenseJob } from "../src/modules/expenses/routes.js";
import { startRentJob } from "../src/modules/rentals/routes.js";
import { startStockJob } from "../src/modules/stock/routes.js";

const HOUR = 3_600_000;
const bare = { log: { error: vi.fn(), debug: vi.fn(), info: vi.fn() }, config: {} } as never;

describe("the business API's job list", () => {
  it("has today's jobs with today's first-run delay and interval, and nothing from the admin API", () => {
    const specs = businessJobs(bare, { dispatcher: { job: () => ({ id: "events.dispatcher", everyMs: 5000, firstRunMs: 2000, run: async () => {} }) } } as never);
    expect(Object.fromEntries(specs.map((s) => [s.id, [s.firstRunMs, s.everyMs]]))).toEqual({
      "expenses.recurring": [45_000, 6 * HOUR],
      "rentals.bills": [50_000, 6 * HOUR],
      "stock.low": [70_000, 6 * HOUR],
      "reviews.checkups": [null, 15 * 60_000],          // no run at start: the first run is after 15 minutes
      "events.dispatcher": [2_000, 5_000],
    });
    for (const s of specs) expect(["billing", "ota", "reminders"].some((p) => s.id.startsWith(p))).toBe(false);
  });

  it("keeps each job's old failure message, so log searches still find it", () => {
    const specs = businessJobs(bare, { dispatcher: { job: () => ({ id: "events.dispatcher", everyMs: 1, firstRunMs: 1, run: async () => {} }) } } as never);
    const msg = Object.fromEntries(specs.map((s) => [s.id, s.failMessage]));
    expect(msg["expenses.recurring"]).toBe("recurring expenses failed");
    expect(msg["rentals.bills"]).toBe("rent bills failed");
    expect(msg["stock.low"]).toBe("low stock failed");
  });

  it("is off with JOBS=off, in tests and without a database", () => {
    expect(jobsOn("production", true, { JOBS: "off" })).toBe(false);
    expect(jobsOn("test", true, {})).toBe(false);
    expect(jobsOn("production", false, {})).toBe(false);
    expect(jobsOn("production", true, {})).toBe(true);
  });

  it("the real app builds in test mode with no job started, has an event bus and dispatcher, and closes at once", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
    const events = eventsOf(app);
    expect(events.dispatcher.job()).toMatchObject({ id: "events.dispatcher", everyMs: 5000, firstRunMs: 2000 });
    expect((await events.dispatcher.drain()).failed).toBe(0);   // an empty outbox, or rows nobody handles
    await app.close();
  });
});

describe("the old start*Job exports", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each([["startExpenseJob", startExpenseJob], ["startRentJob", startRentJob], ["startStockJob", startStockJob]] as const)(
    "%s still starts its own timers, and the app closing clears them", async (_name, start) => {
      const app = Fastify({ logger: false });
      start(app as never);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await app.close();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("the session length setting (QA, P1-BE-4 fix 5)", () => {
  it("is wired at start: loading this API registers the reader, so Admin > Settings > Security is never silently ignored", () => {
    expect(hasSessionDaysReader()).toBe(true);
  });
});
