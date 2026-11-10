// Tests of the admin API's background jobs (admin/backend/src/jobs.ts) and of the old start*Job shims.
// Where it fits: platform/test/jobs-registry.test.ts proves the registry itself; this file proves the admin API hands it the same jobs,
// with the same first-run delays and intervals, as the separate timers had before P1-BE-4, and runs none of the business API's jobs.
// How it works: the specs are built with a bare stand-in for the app (nothing runs until a timer fires); the shims are started on a plain
// Fastify instance with a fake clock. No database needed.
// Run with: npm run test -w @sheetal/admin-api
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminJobs } from "../src/jobs.js";
import { hasSessionDaysReader } from "@sheetal/platform/auth/sessions";
import "../src/app.js";   // loading the API registers the session-length reader
import { startBillingJob } from "../src/modules/billing.js";
import { startOtaJob } from "../src/modules/insight.js";
import { startReminderJob } from "../src/modules/reminders.js";

const HOUR = 3_600_000;

describe("the admin API's job list", () => {
  it("has today's jobs with today's first-run delay and interval, and nothing from the business API or the dispatcher", () => {
    const specs = adminJobs({} as never);
    expect(Object.fromEntries(specs.map((s) => [s.id, [s.firstRunMs, s.everyMs]]))).toEqual({
      "billing.renewal": [30_000, 6 * HOUR],
      "ota.calendar-sync": [60_000, 2 * HOUR],
      "reminders.expiry": [120_000, HOUR],
    });
    expect(specs.map((s) => s.failMessage)).toEqual(["billing cycle failed", "calendar sync failed", "expiry reminders failed"]);
  });
});

describe("the old start*Job exports", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each([["startBillingJob", startBillingJob], ["startOtaJob", startOtaJob], ["startReminderJob", startReminderJob]] as const)(
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
