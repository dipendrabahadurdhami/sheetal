// The jobs registry: the one place that starts and stops every background timer of an API process.
// Where it fits: each API (business, admin) builds its list of JobSpec and calls startJobs() once at the end of buildApp().
// The old start*Job() functions (startExpenseJob, startBillingJob...) stay as shims over the same specs; the event dispatcher
// (platform/src/jobs/dispatcher.ts) is one more job in the list.
// How it works: a job is { id, everyMs, firstRunMs, run }. startJobs() creates a registry, starts a timer pair per job (one first run
// after firstRunMs, then every everyMs; firstRunMs null = no first run, the first run is after one interval) and stops them all when
// the app closes. A run that throws is logged under the job's own message and never stops its timer or any other job. A job never
// overlaps itself: a tick that finds the previous run still going is skipped.
// Rules: the intervals and first-run delays are the ones the jobs had before this registry (they are listed in each API's jobs file and
// tested). JOBS=off, NODE_ENV=test or no database turns every job off (jobsOn). Each API lists only its own jobs. Timers are unref()'d, so
// they never keep a process alive. The mail server's timers are a separate process and are not here.

import type { FastifyBaseLogger, FastifyInstance } from "fastify";

export interface JobSpec {
  /** "<app>.<what>", unique in one process: "expenses.recurring". */
  id: string;
  /** Milliseconds between runs. */
  everyMs: number;
  /** Milliseconds until the first run after start. null = no first run (the first run is after one interval). */
  firstRunMs: number | null;
  /** One run. Log your own success lines; a thrown error is logged by the registry and the timer carries on. */
  run(): Promise<unknown>;
  /** The line logged when a run throws (kept as it was before the registry, so log searches still work). Default "<id> failed". */
  failMessage?: string;
}

/** What a registry needs of a logger (Fastify's logger fits). */
export type JobLog = Pick<FastifyBaseLogger, "error" | "debug">;

export interface JobInfo { id: string; everyMs: number; firstRunMs: number | null; running: boolean }

interface Slot { spec: JobSpec; first: NodeJS.Timeout | null; every: NodeJS.Timeout | null; running: Promise<void> | null }

/** How long stop() waits for runs that are still going before it lets go (so a stuck job can never block shutting down). */
const STOP_WAIT_MS = 5_000;

export class JobRegistry {
  private readonly slots = new Map<string, Slot>();
  private started = false;
  constructor(private readonly log: JobLog) {}

  /** Adds a job. Before start() only: a registry is built, started and stopped as a whole. */
  add(spec: JobSpec): this {
    if (this.started) throw new Error(`Job "${spec.id}" was added after the registry started.`);
    if (this.slots.has(spec.id)) throw new Error(`Job "${spec.id}" is already registered.`);
    if (!Number.isFinite(spec.everyMs) || spec.everyMs < 1) throw new Error(`Job "${spec.id}" needs everyMs of at least 1.`);
    if (spec.firstRunMs !== null && (!Number.isFinite(spec.firstRunMs) || spec.firstRunMs < 0)) throw new Error(`Job "${spec.id}" has a bad firstRunMs.`);
    this.slots.set(spec.id, { spec, first: null, every: null, running: null });
    return this;
  }

  /** Starts every timer. Safe to call twice (the second call does nothing). */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const slot of this.slots.values()) {
      const tick = () => { void this.runSlot(slot); };
      if (slot.spec.firstRunMs !== null) { slot.first = setTimeout(tick, slot.spec.firstRunMs); slot.first.unref(); }
      slot.every = setInterval(tick, slot.spec.everyMs);
      slot.every.unref();
    }
  }

  /** Clears every timer and waits (a few seconds at most) for runs that are still going. Safe to call twice. */
  async stop(): Promise<void> {
    for (const slot of this.slots.values()) {
      if (slot.first) clearTimeout(slot.first);
      if (slot.every) clearInterval(slot.every);
      slot.first = null; slot.every = null;
    }
    const going = [...this.slots.values()].map((s) => s.running).filter((r): r is Promise<void> => !!r);
    if (!going.length) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(going), new Promise<void>((resolve) => { timer = setTimeout(resolve, STOP_WAIT_MS); timer.unref(); })]);
    if (timer) clearTimeout(timer);
  }

  /** Runs one job now (tests, and "run it now" buttons). Resolves when the run ended; an error is logged, not thrown. */
  async runNow(id: string): Promise<void> {
    const slot = this.slots.get(id);
    if (!slot) throw new Error(`No job "${id}" is registered.`);
    await this.runSlot(slot);
  }

  list(): JobInfo[] {
    return [...this.slots.values()].map((s) => ({ id: s.spec.id, everyMs: s.spec.everyMs, firstRunMs: s.spec.firstRunMs, running: !!s.running }));
  }

  private runSlot(slot: Slot): Promise<void> {
    if (slot.running) { this.log.debug({ job: slot.spec.id }, "job still running; this tick is skipped"); return slot.running; }
    const p = (async () => {
      try { await slot.spec.run(); }
      catch (err) { this.log.error({ err, job: slot.spec.id }, slot.spec.failMessage ?? `${slot.spec.id} failed`); }
    })().finally(() => { slot.running = null; });
    slot.running = p;
    return p;
  }
}

/**
 * Whether background jobs run in this process: not in tests, not with JOBS=off, and only with a database. This is the check each
 * app.ts used to write out by hand (`config.NODE_ENV !== "test" && process.env.JOBS !== "off" && app.db`).
 */
export const jobsOn = (nodeEnv: string, hasDb: boolean, env: Record<string, string | undefined> = process.env): boolean =>
  nodeEnv !== "test" && env.JOBS !== "off" && hasDb;

/**
 * Starts the given jobs for an API and stops them when the app closes. Returns the registry, or null when jobs are off.
 * `enabled` is what the caller decides (usually jobsOn(config.NODE_ENV, !!app.db)); the old start*Job() shims pass true.
 */
export function startJobs(app: FastifyInstance, specs: readonly JobSpec[], opts: { enabled: boolean }): JobRegistry | null {
  if (!opts.enabled) return null;
  const registry = new JobRegistry(app.log);
  for (const spec of specs) registry.add(spec);
  registry.start();
  app.addHook("onClose", async () => { await registry.stop(); });
  return registry;
}
