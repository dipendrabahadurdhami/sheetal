// The Integration Center's engine: saving details, testing, going live, pausing, staged changes, the test log and health (INTEGRATIONS.md sections 4, 6, 12).
// Where it fits: routes.ts calls it for the admin screens (scope "platform"); a business twin under /v1/integrations arrives with the Phase 2 settings screens
// and uses the same class with scope "business". health.ts calls runHealth() every 15 minutes. Old readers (billing's gateways(), the website's Analytics tag)
// keep reading their old settings rows, which legacy.ts rewrites after every change here, so nothing that works today changes.
// How it works:
//   - A connection is identified by (integration id, owner): the owner is "platform" or a business id. No row = "not set up".
//   - Secrets are sealed one value per field with the vault's bound format (v2, bound to "<connectionId>:<mode>:<field>"), in a set per mode. A value sealed
//     for test never opens as live, and the other mode cannot be read during a call (the reader is bound to one mode).
//   - Before going live, "test" details are edited in place; "live" details wait beside them and are swapped in by Go live after a live probe passes.
//   - A change to a live or paused connection is STAGED: it is tested on its own and only then applied, so a typo never breaks what is live.
//   - Every test, go-live and health probe writes a log row; every change writes an audit row with field NAMES only.
// Rules: nothing here returns a secret. Messages from providers pass through safeMessage(). Permissions are checked by the routes, not here.

import { Prisma } from "@prisma/client";
import type { Vault } from "../auth/vault.js";
import { AppError, badRequest, notFound, versionConflict } from "../core/errors.js";
import type { Db } from "../db/client.js";
import { missingFields } from "./fields.js";
import { integrationOf, specsFor } from "./registry.js";
import { TransitionError, healthAfter, next, stagesChanges, usable, type Action } from "./state.js";
import type {
  ConnectionState, ConnectionView, Fetch, GuideStep, HealthStatus, Integration, IntegrationContext, IntegrationLog, IntegrationScope, IntegrationSpec, Mode, SecretReader, TestResult,
} from "./types.js";

export interface Owner { scope: IntegrationScope; tenantId: string | null }
export interface Who { actorId: string | null; ip?: string | null }
export interface IntegrationDeps {
  db: Db; vault: Vault; env: "development" | "test" | "production"; fetch?: Fetch; log: IntegrationLog; now?: () => Date;
  /** Called after a platform connection changed, so the old settings rows stay in step (legacy.ts). */
  afterChange?: (connectionId: string) => Promise<void>;
}

type Row = NonNullable<Awaited<ReturnType<Db["integrationConnection"]["findUnique"]>>>;
type SetRow = { id: string; mode: string; status: string; sealed: unknown; fieldNames: unknown };
const TESTED = "__tested";
const TIMEOUT_MS = 10_000;
const RETIRED_DAYS = 30;
export const PLATFORM: Owner = { scope: "platform", tenantId: null };
const ownerKey = (o: Owner) => (o.scope === "platform" ? "platform" : o.tenantId ?? "");
const asRecord = (v: unknown): Record<string, string> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {});
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const clean = (cfg: Record<string, string>) => Object.fromEntries(Object.entries(cfg).filter(([k]) => k !== TESTED));
const firstMode = (spec: IntegrationSpec): Mode => (spec.modes.includes("test") ? "test" : "live");

/** fetch with a 10-second limit that never follows a redirect to another place. */
export function guardedFetch(inner: Fetch): Fetch {
  return ((input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => inner(input, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) })) as Fetch;
}

export function toView(spec: IntegrationSpec, owner: Owner, row: Row | null, sets: readonly SetRow[]): ConnectionView {
  const of = (mode: Mode, status: string) => names(sets.find((s) => s.mode === mode && s.status === status)?.fieldNames);
  if (!row) {
    return {
      id: null, integrationId: spec.id, scope: owner.scope, tenantId: owner.tenantId, state: "none", mode: firstMode(spec), config: {}, stagedConfig: null,
      has: { test: [], live: [], staged: [] }, reviewStatus: "none", reviewNote: null, lastTestAt: null, lastTestOk: null, pauseReason: null,
      health: { status: "unknown", message: null, checkedAt: null }, version: 0,
    };
  }
  return {
    id: row.id, integrationId: row.integrationId, scope: owner.scope, tenantId: row.tenantId, state: row.state as ConnectionState, mode: row.mode as Mode,
    config: asRecord(row.config), stagedConfig: row.stagedConfig ? clean(asRecord(row.stagedConfig)) : null,
    has: { test: of("test", "active"), live: of("live", "active"), staged: of(row.mode as Mode, "staged") },
    reviewStatus: row.reviewStatus as ConnectionView["reviewStatus"], reviewNote: row.reviewNote, lastTestAt: row.lastTestAt, lastTestOk: row.lastTestOk,
    pauseReason: row.pauseReason, health: { status: row.healthStatus as HealthStatus, message: row.healthMessage, checkedAt: row.healthCheckedAt }, version: row.version,
  };
}

/** What a screen gets for one integration: the spec without functions, the connection without secrets, the steps as booleans. */
export function present(spec: IntegrationSpec, view: ConnectionView) {
  const { steps, guide: _guide, ...rest } = spec;
  return {
    spec: rest, connection: view,
    steps: steps.map((s) => ({ id: s.id, label: s.label, done: view.state !== "none" && s.done(view), wait: view.state !== "none" && !!s.wait?.(view) })),
    /** Has a live-details change or a staged change been tested and is ready to apply? */
    stagedTested: false as boolean,
  };
}

export class IntegrationService {
  constructor(private readonly d: IntegrationDeps) {}
  private now() { return this.d.now?.() ?? new Date(); }

  private need(id: string, owner: Owner): Integration {
    const i = integrationOf(id);
    if (!i || !i.describe().scopes.includes(owner.scope)) throw notFound("That connection does not exist.");
    if (owner.scope === "business" && !owner.tenantId) throw notFound("That connection does not exist.");
    return i;
  }
  private async load(id: string, owner: Owner) {
    const row = await this.d.db.integrationConnection.findUnique({ where: { integrationId_ownerKey: { integrationId: id, ownerKey: ownerKey(owner) } }, include: { secrets: { where: { status: { in: ["active", "staged"] } } } } });
    return { row: row as Row | null, sets: (row?.secrets ?? []) as SetRow[] };
  }
  private reader(row: Row, sets: readonly SetRow[], mode: Mode, staged: boolean): SecretReader {
    const active = asRecord(sets.find((s) => s.mode === mode && s.status === "active")?.sealed);
    const sealed = staged ? { ...active, ...asRecord(sets.find((s) => s.mode === mode && s.status === "staged")?.sealed) } : active;
    const vault = this.d.vault;
    return {
      has: (field) => typeof sealed[field] === "string" && sealed[field] !== "",
      get: (field) => {
        const v = sealed[field];
        if (!v) return undefined;
        try { return vault.open(v, `${row.id}:${mode}:${field}`); } catch { return undefined; }   // a value copied from another place does not open
      },
    };
  }
  private ctx(spec: IntegrationSpec, owner: Owner, row: Row, sets: readonly SetRow[], o: { mode: Mode; config: Record<string, string>; staged?: boolean }): IntegrationContext {
    return {
      connection: toView(spec, owner, row, sets), config: clean(o.config), mode: o.mode, secrets: this.reader(row, sets, o.mode, !!o.staged),
      env: this.d.env, fetch: guardedFetch(this.d.fetch ?? fetch), log: this.d.log, now: this.now(),
    };
  }
  private async audit(owner: Owner, who: Who, id: string, action: string, meta: Record<string, unknown>) {
    await this.d.db.auditLog.create({ data: { tenantId: owner.tenantId, actorId: who.actorId, action: `integration.${id}.${action}`, target: id, ip: who.ip ?? null, meta: meta as Prisma.InputJsonValue } });
  }
  private async log(row: Row, kind: string, mode: Mode, r: TestResult, started: number, who: Who | null) {
    await this.d.db.integrationTestLog.create({ data: { connectionId: row.id, kind, mode, ok: r.ok, checks: r.checks as unknown as Prisma.InputJsonValue, durationMs: Math.max(0, Date.now() - started), actorId: who?.actorId ?? null } });
    // Keep the last 200 rows per connection.
    const old = await this.d.db.integrationTestLog.findMany({ where: { connectionId: row.id }, orderBy: { at: "desc" }, skip: 200, take: 200, select: { id: true } });
    if (old.length) await this.d.db.integrationTestLog.deleteMany({ where: { id: { in: old.map((x) => x.id) } } });
  }
  private move(state: ConnectionState | "none", action: Action, extra: Omit<Parameters<typeof next>[0], "state" | "action"> = {}): ConnectionState {
    try { return next({ state, action, ...extra }); }
    catch (e) { if (e instanceof TransitionError) throw badRequest(e.message); throw e; }
  }
  private async changed(row: Row, owner: Owner) { if (owner.scope === "platform") await this.d.afterChange?.(row.id); }
  private async view(id: string, owner: Owner) {
    const spec = this.need(id, owner).describe();
    const { row, sets } = await this.load(id, owner);
    const out = present(spec, toView(spec, owner, row, sets));
    out.stagedTested = !!row?.stagedConfig && !!asRecord(row.stagedConfig)[TESTED];
    return out;
  }

  // ── Reading ──

  async list(owner: Owner) {
    const rows = await this.d.db.integrationConnection.findMany({ where: { ownerKey: ownerKey(owner) }, include: { secrets: { where: { status: { in: ["active", "staged"] } } } } });
    const byId = new Map(rows.map((r) => [r.integrationId, r]));
    return specsFor(owner.scope).map((spec) => {
      const r = byId.get(spec.id);
      return present(spec, toView(spec, owner, (r ?? null) as Row | null, (r?.secrets ?? []) as SetRow[]));
    });
  }
  get(owner: Owner, id: string) { return this.view(id, owner); }

  async testLog(owner: Owner, id: string) {
    this.need(id, owner);
    const { row } = await this.load(id, owner);
    if (!row) return [];
    return this.d.db.integrationTestLog.findMany({ where: { connectionId: row.id }, orderBy: { at: "desc" }, take: 50, select: { id: true, kind: true, mode: true, ok: true, checks: true, durationMs: true, at: true } });
  }

  async guide(owner: Owner, id: string, lang = "en"): Promise<{ title: string; steps: readonly GuideStep[]; lang: string; edited: boolean }> {
    const spec = this.need(id, owner).describe();
    const key = `guide.integration.${id}.${owner.scope}`;
    const rows = await this.d.db.helpGuide.findMany({ where: { key, status: "published", lang: { in: [lang, "en"] } } });
    const hit = rows.find((r) => r.lang === lang) ?? rows.find((r) => r.lang === "en");
    if (hit && Array.isArray(hit.steps)) return { title: hit.title, steps: hit.steps as unknown as GuideStep[], lang: hit.lang, edited: true };
    return { title: `How to connect ${spec.name.en}`, steps: spec.guide, lang: "en", edited: false };
  }

  // ── Saving ──

  /**
   * Saves fields. `mode` says which details are meant ("test" or "live"); the default is the connection's own mode. Secret fields are sealed for that mode.
   * An empty string clears a non-secret field; a secret field is only ever replaced, never read back.
   */
  async save(owner: Owner, who: Who, id: string, body: { values: Record<string, string | undefined>; mode?: Mode; version?: number }) {
    const integration = this.need(id, owner);
    const spec = integration.describe();
    const values = Object.fromEntries(Object.entries(body.values).filter(([, v]) => v !== undefined)) as Record<string, string>;
    const checked = integration.validate(values);
    if (!checked.ok) throw new AppError(422, "validation", "Please check the highlighted fields.", checked.errors);

    let { row, sets } = await this.load(id, owner);
    if (row && body.version !== undefined && body.version !== row.version) throw versionConflict("This connection");
    if (!row) {
      row = (await this.d.db.integrationConnection.create({ data: { integrationId: id, scope: owner.scope, tenantId: owner.tenantId, ownerKey: ownerKey(owner), state: "draft", mode: firstMode(spec), config: {}, createdBy: who.actorId } })) as Row;
      sets = [];
    }
    const current = row.mode as Mode;
    const mode = body.mode ?? current;
    if (!spec.modes.includes(mode)) throw badRequest(`${spec.name.en} has no ${mode} details.`);
    const state = row.state as ConnectionState;
    const staged = stagesChanges(state);
    const otherMode = mode !== current;
    if (otherMode && mode === "live" && !staged && state !== "test_passed") throw badRequest("Test the test details first. Live details can be saved after a passing test.");
    if (otherMode && staged) throw badRequest("This connection is live. Change its live details; they are tested before they replace the current ones.");

    const secretKeys = new Set(spec.fields.filter((f) => f.secret).map((f) => f.key));
    const plain: Record<string, string> = {}; const secret: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) { if (secretKeys.has(k)) { if (v !== "") secret[k] = v; } else plain[k] = v.trim(); }
    const changedNames = [...Object.keys(plain).filter((k) => (asRecord(row!.config)[k] ?? "") !== plain[k]), ...Object.keys(secret).map((k) => `${k} (replaced)`)];
    if (!changedNames.length) return { message: "Nothing changed.", data: await this.view(id, owner) };

    const merge = (base: Record<string, string>) => { const out = { ...base }; for (const [k, v] of Object.entries(plain)) { if (v === "") delete out[k]; else out[k] = v; } return out; };
    const seal = (m: Mode) => Object.fromEntries(Object.entries(secret).map(([k, v]) => [k, this.d.vault.seal(v, `${row!.id}:${m}:${k}`)]));
    const upsertSet = async (tx: Prisma.TransactionClient, m: Mode, status: "active" | "staged", base: Record<string, string>) => {
      if (!Object.keys(secret).length) return;
      const sealed = { ...base, ...seal(m) };
      const had = sets.find((s) => s.mode === m && s.status === status);
      const data = { sealed: sealed as Prisma.InputJsonValue, fieldNames: Object.keys(sealed) as Prisma.InputJsonValue };
      if (had) await tx.integrationSecretSet.update({ where: { id: had.id }, data });
      else await tx.integrationSecretSet.create({ data: { connectionId: row!.id, mode: m, status, createdBy: who.actorId, ...data } });
    };
    const activeOf = (m: Mode) => asRecord(sets.find((s) => s.mode === m && s.status === "active")?.sealed);

    let message = "";
    await this.d.db.$transaction(async (tx) => {
      if (staged) {
        // Live or paused: the change waits in a staged copy.
        const base = merge(clean(asRecord(row!.stagedConfig ?? row!.config)));
        await upsertSet(tx, current, "staged", { ...activeOf(current), ...asRecord(sets.find((s) => s.mode === current && s.status === "staged")?.sealed) });
        await tx.integrationConnection.update({ where: { id: row!.id }, data: { stagedConfig: base as Prisma.InputJsonValue, version: { increment: 1 } } });
        message = "Saved as a change that is waiting. Test it, then apply it. What is live now is not touched.";
      } else if (otherMode) {
        // Live details saved beside passing test details: they wait until Go live.
        const base = merge(clean(asRecord(row!.stagedConfig ?? {})));
        await upsertSet(tx, "live", "active", activeOf("live"));
        await tx.integrationConnection.update({ where: { id: row!.id }, data: { stagedConfig: base as Prisma.InputJsonValue, version: { increment: 1 } } });
        message = "Live details saved. Press Go live to switch them on.";
      } else {
        const config = merge(asRecord(row!.config));
        await upsertSet(tx, current, "active", activeOf(current));
        const secretNames = [...new Set([...Object.keys(activeOf(current)), ...Object.keys(secret)])];
        const complete = missingFields(spec.fields, config, secretNames, current).length === 0;
        const needsReview = owner.scope === "business" && spec.review?.before === "credentials" && row!.reviewStatus !== "accepted";
        const to = this.move(state, "save", { complete, needsReview });
        await tx.integrationConnection.update({ where: { id: row!.id }, data: { config: config as Prisma.InputJsonValue, state: to, lastTestOk: null, lastTestAt: null, stagedConfig: Prisma.DbNull, version: { increment: 1 } } });
        message = to === "details_entered" ? "Saved. Press Test to check it." : needsReview && complete ? "Saved. Send the documents for review to continue." : "Saved. Some required details are still missing.";
      }
      await tx.auditLog.create({ data: { tenantId: owner.tenantId, actorId: who.actorId, action: `integration.${id}.saved`, target: id, ip: who.ip ?? null, meta: { fields: changedNames, mode, staged } as Prisma.InputJsonValue } });
    });
    if (!staged && !otherMode) await this.changed(row, owner);
    return { message, data: await this.view(id, owner) };
  }

  // ── Testing ──

  async test(owner: Owner, who: Who, id: string, o: { staged?: boolean } = {}) {
    const integration = this.need(id, owner);
    const spec = integration.describe();
    const { row, sets } = await this.load(id, owner);
    if (!row) throw badRequest("Enter the details first, then test.");
    const state = row.state as ConnectionState;
    const mode = row.mode as Mode;
    const live = stagesChanges(state);
    if (o.staged && (!live || !row.stagedConfig)) throw badRequest("There is no waiting change to test.");
    if (!o.staged) this.move(state, "test", { ok: true });      // refuses "draft" with a plain sentence before any network call
    const started = Date.now();
    const config = o.staged ? asRecord(row.stagedConfig) : asRecord(row.config);
    const result = await integration.test(this.ctx(spec, owner, row, sets, { mode, config, staged: o.staged }));
    await this.log(row, o.staged ? "staged_test" : "test", mode, result, started, who);
    if (o.staged) {
      const next_ = { ...clean(config), ...(result.ok ? { [TESTED]: this.now().toISOString() } : {}) };
      await this.d.db.integrationConnection.update({ where: { id: row.id }, data: { stagedConfig: next_ as Prisma.InputJsonValue } });
    } else {
      const to = this.move(state, "test", { ok: result.ok });
      await this.d.db.integrationConnection.update({ where: { id: row.id }, data: { state: to, lastTestAt: this.now(), lastTestOk: result.ok, ...(live ? healthPatch(result.ok) : {}) } });
    }
    await this.audit(owner, who, id, o.staged ? "staged_tested" : "tested", { ok: result.ok, mode });
    return { message: result.ok ? "The test passed." : "The test failed. See the checks below.", data: { ...result, ...(await this.view(id, owner)) } };
  }

  // ── Switching on and off ──

  async goLive(owner: Owner, who: Who, id: string) {
    const integration = this.need(id, owner);
    const spec = integration.describe();
    const { row, sets } = await this.load(id, owner);
    if (!row) throw badRequest("Enter the details first.");
    if (!spec.built) throw badRequest(`${spec.name.en} cannot be switched on yet. Its details are kept for when it is ready.`);
    this.move(row.state as ConnectionState, "go_live", { lastTestAt: row.lastTestAt, lastTestOk: row.lastTestOk, now: this.now() });
    for (const need of spec.requires ?? []) {
      const dep = await this.d.db.integrationConnection.findUnique({ where: { integrationId_ownerKey: { integrationId: need, ownerKey: "platform" } }, select: { state: true } });
      if (dep?.state !== "live") throw badRequest(`Switch on ${integrationOf(need)?.describe().name.en ?? need} first.`);
    }
    const config = { ...asRecord(row.config), ...clean(asRecord(row.stagedConfig ?? {})) };
    const liveNames = names(sets.find((s) => s.mode === "live" && s.status === "active")?.fieldNames);
    const missing = missingFields(spec.fields, config, liveNames, "live");
    if (missing.length) throw badRequest(`Save the live details first: ${missing.map((k) => spec.fields.find((f) => f.key === k)?.label.en ?? k).join(", ")}.`);
    const ctx = this.ctx(spec, owner, row, sets, { mode: "live", config });
    if (row.mode !== "live") {
      // A read-only probe with the live details: nothing goes live on details that do not work.
      const started = Date.now();
      const probe = await integration.test(ctx);
      await this.log(row, "go_live", "live", probe, started, who);
      if (!probe.ok) throw badRequest(`The live details did not pass: ${probe.checks.find((c) => !c.ok)?.message ?? "the check failed."}`);
    }
    const on = await integration.goLive(ctx);
    if (!on.ok) throw badRequest(on.message);
    await this.d.db.integrationConnection.update({
      where: { id: row.id },
      data: { state: "live", mode: "live", config: config as Prisma.InputJsonValue, stagedConfig: Prisma.DbNull, goLiveAt: this.now(), goLiveBy: who.actorId, pausedAt: null, pausedBy: null, pauseReason: null, healthStatus: "healthy", healthMessage: null, healthFailures: 0, healthCheckedAt: this.now(), version: { increment: 1 } },
    });
    await this.audit(owner, who, id, "went_live", { from: row.state, to: "live" });
    await this.changed(row, owner);
    return { message: `${spec.name.en} is live.`, data: await this.view(id, owner) };
  }

  async pause(owner: Owner, who: Who, id: string, reason: string) {
    const integration = this.need(id, owner);
    const spec = integration.describe();
    const { row, sets } = await this.load(id, owner);
    if (!row) throw badRequest("There is nothing to pause.");
    const why = (reason ?? "").trim();
    if (why.length < 5 || why.length > 300) throw badRequest("Give a reason of 5 to 300 characters.");
    this.move(row.state as ConnectionState, "pause");
    await integration.pause(this.ctx(spec, owner, row, sets, { mode: row.mode as Mode, config: asRecord(row.config) })).catch((err: unknown) => this.d.log.warn({ err, id }, "integration pause: provider side failed"));
    await this.d.db.integrationConnection.update({ where: { id: row.id }, data: { state: "paused", pausedAt: this.now(), pausedBy: who.actorId, pauseReason: why, version: { increment: 1 } } });
    await this.audit(owner, who, id, "paused", { reason: why });
    await this.changed(row, owner);
    return { message: `${spec.name.en} is paused. Its details are kept.`, data: await this.view(id, owner) };
  }

  async resume(owner: Owner, who: Who, id: string) {
    const integration = this.need(id, owner);
    const spec = integration.describe();
    const { row, sets } = await this.load(id, owner);
    if (!row) throw badRequest("There is nothing to resume.");
    this.move(row.state as ConnectionState, "resume");
    const h = await integration.health(this.ctx(spec, owner, row, sets, { mode: row.mode as Mode, config: asRecord(row.config) }));
    if (h.status === "down") throw badRequest(`It does not answer yet: ${h.message}`);
    await this.d.db.integrationConnection.update({ where: { id: row.id }, data: { state: "live", pausedAt: null, pausedBy: null, pauseReason: null, healthStatus: h.status, healthMessage: h.message, healthFailures: 0, healthCheckedAt: this.now(), version: { increment: 1 } } });
    await this.audit(owner, who, id, "resumed", {});
    await this.changed(row, owner);
    return { message: `${spec.name.en} is live again.`, data: await this.view(id, owner) };
  }

  /** Swaps a tested, waiting change into a live or paused connection. The old secrets are kept 30 days as "retired". */
  async apply(owner: Owner, who: Who, id: string) {
    this.need(id, owner);
    const { row, sets } = await this.load(id, owner);
    if (!row || !stagesChanges(row.state as ConnectionState) || !row.stagedConfig) throw badRequest("There is no waiting change to apply.");
    const stagedCfg = asRecord(row.stagedConfig);
    if (!stagedCfg[TESTED]) throw badRequest("Test the waiting change first. It is applied only after its test passes.");
    const mode = row.mode as Mode;
    const stagedSet = sets.find((s) => s.mode === mode && s.status === "staged");
    const activeSet = sets.find((s) => s.mode === mode && s.status === "active");
    await this.d.db.$transaction(async (tx) => {
      if (stagedSet) {
        if (activeSet) await tx.integrationSecretSet.update({ where: { id: activeSet.id }, data: { status: "retired" } });
        await tx.integrationSecretSet.update({ where: { id: stagedSet.id }, data: { status: "active" } });
      }
      await tx.integrationSecretSet.deleteMany({ where: { connectionId: row.id, status: "retired", createdAt: { lt: new Date(this.now().getTime() - RETIRED_DAYS * 864e5) } } });
      await tx.integrationConnection.update({ where: { id: row.id }, data: { config: clean(stagedCfg) as Prisma.InputJsonValue, stagedConfig: Prisma.DbNull, lastTestAt: this.now(), lastTestOk: true, version: { increment: 1 } } });
      await tx.auditLog.create({ data: { tenantId: owner.tenantId, actorId: who.actorId, action: `integration.${id}.applied`, target: id, ip: who.ip ?? null } });
    });
    await this.changed(row, owner);
    return { message: "The change is applied.", data: await this.view(id, owner) };
  }

  /** Forgets the details (secrets are deleted). The row stays as "draft" with its test log. */
  async disconnect(owner: Owner, who: Who, id: string) {
    const integration = this.need(id, owner);
    const spec = integration.describe();
    const { row, sets } = await this.load(id, owner);
    if (!row) throw badRequest("There is nothing to disconnect.");
    this.move(row.state as ConnectionState, "disconnect");
    if (row.state === "live") await integration.pause(this.ctx(spec, owner, row, sets, { mode: row.mode as Mode, config: asRecord(row.config) })).catch(() => undefined);
    await this.d.db.$transaction(async (tx) => {
      await tx.integrationSecretSet.deleteMany({ where: { connectionId: row.id } });
      await tx.integrationConnection.update({ where: { id: row.id }, data: { state: "draft", mode: firstMode(spec), config: {}, stagedConfig: Prisma.DbNull, lastTestAt: null, lastTestOk: null, goLiveAt: null, goLiveBy: null, pausedAt: null, pausedBy: null, pauseReason: null, healthStatus: "unknown", healthMessage: null, healthFailures: 0, version: { increment: 1 } } });
      await tx.auditLog.create({ data: { tenantId: owner.tenantId, actorId: who.actorId, action: `integration.${id}.disconnected`, target: id, ip: who.ip ?? null, meta: { from: row.state } as Prisma.InputJsonValue } });
    });
    await this.changed(row, owner);
    return { message: `${spec.name.en} is disconnected. Its keys were deleted.`, data: await this.view(id, owner) };
  }

  // ── For apps and jobs ──

  /** The details an app may use now, or null (not set up, paused, down, or a shell). The secrets are bound to the connection's mode. */
  async resolve(owner: Owner, id: string): Promise<{ mode: Mode; config: Record<string, string>; secrets: SecretReader } | null> {
    const i = integrationOf(id);
    if (!i || !i.describe().built) return null;
    const { row, sets } = await this.load(id, owner);
    if (!row || !usable({ state: row.state as ConnectionState, mode: row.mode as Mode, health: row.healthStatus as HealthStatus }, this.d.env)) return null;
    return { mode: row.mode as Mode, config: asRecord(row.config), secrets: this.reader(row, sets, row.mode as Mode, false) };
  }

  /** The same check as resolve(), as the full context a provider's own calls take (the AI router calls complete() with it). null = not usable. */
  async contextFor(owner: Owner, id: string): Promise<IntegrationContext | null> {
    const i = integrationOf(id);
    if (!i || !i.describe().built || !i.describe().scopes.includes(owner.scope)) return null;
    const { row, sets } = await this.load(id, owner);
    if (!row || !usable({ state: row.state as ConnectionState, mode: row.mode as Mode, health: row.healthStatus as HealthStatus }, this.d.env)) return null;
    return this.ctx(i.describe(), owner, row, sets, { mode: row.mode as Mode, config: asRecord(row.config) });
  }

  /** One round of the health job: every live connection is probed once; three failures in a row = down (told once), the first success clears it. */
  async runHealth(notify?: (o: { row: { id: string; integrationId: string; scope: string; tenantId: string | null }; alert: "down" | "back"; name: string; message: string }) => Promise<void>): Promise<{ checked: number; down: number }> {
    const rows = await this.d.db.integrationConnection.findMany({ where: { state: "live" }, include: { secrets: { where: { status: "active" } } }, take: 500 });
    let down = 0;
    for (const r of rows) {
      const integration = integrationOf(r.integrationId);
      if (!integration || !integration.describe().built) continue;
      const spec = integration.describe();
      const owner: Owner = { scope: r.scope as IntegrationScope, tenantId: r.tenantId };
      const started = Date.now();
      let probe: { status: HealthStatus; message: string };
      try { probe = await integration.health(this.ctx(spec, owner, r as Row, r.secrets as SetRow[], { mode: r.mode as Mode, config: asRecord(r.config) })); }
      catch { probe = { status: "down", message: "Couldn't reach the service." }; }
      const after = healthAfter({ status: r.healthStatus as HealthStatus, failures: r.healthFailures }, probe.status);
      if (after.status === "down") down++;
      await this.d.db.integrationConnection.update({ where: { id: r.id }, data: { healthStatus: after.status, healthMessage: probe.message, healthFailures: after.failures, healthCheckedAt: this.now(), ...(after.alert === "down" ? { healthAlertedAt: this.now() } : after.alert === "back" ? { healthAlertedAt: null } : {}) } });
      if (probe.status !== "healthy") await this.log(r as Row, "health", r.mode as Mode, { ok: false, checks: [{ name: "Health", ok: false, message: probe.message }] }, started, null);
      if (after.alert && notify) await notify({ row: r, alert: after.alert, name: spec.name.en, message: probe.message }).catch((err: unknown) => this.d.log.warn({ err }, "integration health: notice failed"));
    }
    return { checked: rows.length, down };
  }
}

const healthPatch = (ok: boolean) => (ok ? { healthStatus: "healthy", healthFailures: 0, healthMessage: null } : {});
