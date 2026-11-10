// Tests of the jobs registry (platform/src/jobs/registry.ts): timing, JOBS=off, stopping on close, and one job failing alone.
// Where it fits: pure tests, no database; the clock is faked, so nothing waits. Run with: npm run test -w @sheetal/platform
// What they prove: first-run delay and interval are exactly what each job asks for; a job with no first run waits one interval;
// a throwing job is logged under its own message and keeps its timer while the others keep running; a slow job never overlaps itself;
// stop() clears every timer (also when the Fastify app closes); jobsOn() is the old NODE_ENV / JOBS / database check.
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobRegistry, jobsOn, startJobs, type JobSpec } from "../src/jobs/registry.js";

const logger = () => ({ error: vi.fn(), debug: vi.fn() });
const spec = (id: string, run: () => Promise<unknown>, over: Partial<JobSpec> = {}): JobSpec => ({ id, everyMs: 1000, firstRunMs: 300, run, ...over });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("JobRegistry timing", () => {
  it("runs once after firstRunMs, then every everyMs", async () => {
    const run = vi.fn(async () => {});
    const r = new JobRegistry(logger()).add(spec("a.job", run));
    r.start();
    await vi.advanceTimersByTimeAsync(299);
    expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);          // the first run, at 300 ms
    await vi.advanceTimersByTimeAsync(700);
    expect(run).toHaveBeenCalledTimes(2);          // the first interval tick, at 1000 ms
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(4);          // 2000 and 3000
    await r.stop();
  });

  it("a job with firstRunMs null has no run at start: its first run is after one interval (the check-ups job)", async () => {
    const run = vi.fn(async () => {});
    const r = new JobRegistry(logger()).add(spec("reviews.checkups", run, { everyMs: 900_000, firstRunMs: null }));
    r.start();
    await vi.advanceTimersByTimeAsync(899_999);
    expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await r.stop();
  });

  it("start() twice does not double the timers", async () => {
    const run = vi.fn(async () => {});
    const r = new JobRegistry(logger()).add(spec("a.job", run));
    r.start(); r.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    await r.stop();
  });

  it("every timer is unref()'d, so jobs never keep a process alive", () => {
    const r = new JobRegistry(logger()).add(spec("a.job", async () => {}));
    const unref = vi.spyOn(globalThis, "setInterval");
    r.start();
    const timer = unref.mock.results[0]!.value as NodeJS.Timeout & { hasRef?: () => boolean };
    expect(timer.hasRef?.() ?? false).toBe(false);
    unref.mockRestore();
    return r.stop();
  });
});

describe("one job failing", () => {
  it("is logged under its own message, keeps its timer, and never stops the other jobs", async () => {
    const log = logger();
    const bad = vi.fn(async () => { throw new Error("boom"); });
    const good = vi.fn(async () => {});
    const r = new JobRegistry(log).add(spec("billing.renewal", bad, { failMessage: "billing cycle failed" })).add(spec("ota.calendar-sync", good));
    r.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ job: "billing.renewal", err: expect.any(Error) }), "billing cycle failed");
    await vi.advanceTimersByTimeAsync(700);
    expect(bad).toHaveBeenCalledTimes(2);          // still scheduled after a failure
    expect(good).toHaveBeenCalledTimes(2);
    await r.stop();
  });

  it("uses '<id> failed' when the job gives no message", async () => {
    const log = logger();
    const r = new JobRegistry(log).add(spec("x.job", async () => { throw new Error("no"); }));
    await r.runNow("x.job");
    expect(log.error).toHaveBeenCalledWith(expect.anything(), "x.job failed");
  });

  it("a slow job never overlaps itself and does not hold up a fast one", async () => {
    const slow = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 2500)));
    const fast = vi.fn(async () => {});
    const r = new JobRegistry(logger()).add(spec("slow.job", slow, { firstRunMs: null })).add(spec("fast.job", fast, { firstRunMs: null }));
    r.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(slow).toHaveBeenCalledTimes(1);          // ticks at 1000 and 2000 found it still running and were skipped
    expect(fast).toHaveBeenCalledTimes(3);
    expect(r.list().find((j) => j.id === "slow.job")!.running).toBe(true);    // started at 1000, ends at 3500
    await vi.advanceTimersByTimeAsync(1000);
    expect(slow).toHaveBeenCalledTimes(2);          // the tick at 4000 starts it again
    const stopped = r.stop();
    await vi.advanceTimersByTimeAsync(3000);        // let the run that is going finish
    await stopped;
  });
});

describe("stopping", () => {
  it("stop() clears every timer and waits for a run that is going", async () => {
    let finished = false;
    const r = new JobRegistry(logger()).add(spec("a.job", () => new Promise<void>((res) => setTimeout(() => { finished = true; res(); }, 200))));
    r.start();
    await vi.advanceTimersByTimeAsync(300);         // the run has started
    const stopped = r.stop();
    await vi.advanceTimersByTimeAsync(200);
    await stopped;
    expect(finished).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop() gives up on a stuck run after a few seconds", async () => {
    const r = new JobRegistry(logger()).add(spec("a.job", () => new Promise<void>(() => {})));
    r.start();
    await vi.advanceTimersByTimeAsync(300);
    const stopped = r.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await stopped;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("startJobs() stops the jobs when the Fastify app closes, and leaves no timer behind", async () => {
    const run = vi.fn(async () => {});
    const app = Fastify({ logger: false });
    const r = startJobs(app, [spec("a.job", run), spec("b.job", run, { firstRunMs: null })], { enabled: true });
    expect(r).not.toBeNull();
    await app.ready();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    await app.close();
    const calls = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.mock.calls.length).toBe(calls);      // nothing runs after close
    expect(vi.getTimerCount()).toBe(0);
  });

  it("startJobs() with enabled false starts nothing and returns null", async () => {
    const run = vi.fn(async () => {});
    const app = Fastify({ logger: false });
    expect(startJobs(app, [spec("a.job", run)], { enabled: false })).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await app.close();
  });
});

describe("jobsOn (the old NODE_ENV / JOBS / database check)", () => {
  it("is on only outside tests, without JOBS=off, with a database", () => {
    expect(jobsOn("development", true, {})).toBe(true);
    expect(jobsOn("production", true, { JOBS: "on" })).toBe(true);
    expect(jobsOn("production", true, { JOBS: "off" })).toBe(false);
    expect(jobsOn("test", true, {})).toBe(false);
    expect(jobsOn("production", false, {})).toBe(false);
  });
});

describe("registering", () => {
  it("refuses a duplicate id, a bad interval, a bad first run, and an add after start", () => {
    const r = new JobRegistry(logger()).add(spec("a.job", async () => {}));
    expect(() => r.add(spec("a.job", async () => {}))).toThrow(/already registered/);
    expect(() => r.add(spec("b.job", async () => {}, { everyMs: 0 }))).toThrow(/everyMs/);
    expect(() => r.add(spec("c.job", async () => {}, { firstRunMs: -1 }))).toThrow(/firstRunMs/);
    r.start();
    expect(() => r.add(spec("d.job", async () => {}))).toThrow(/after the registry started/);
    return r.stop();
  });
  it("lists the jobs and runs one by name; an unknown name is an error", async () => {
    const run = vi.fn(async () => {});
    const r = new JobRegistry(logger()).add(spec("a.job", run, { everyMs: 5000, firstRunMs: 2000 }));
    expect(r.list()).toEqual([{ id: "a.job", everyMs: 5000, firstRunMs: 2000, running: false }]);
    await r.runNow("a.job");
    expect(run).toHaveBeenCalledTimes(1);
    await expect(r.runNow("nope")).rejects.toThrow(/No job/);
  });
});
