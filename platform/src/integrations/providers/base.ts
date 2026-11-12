// What every provider shares: the usual steps, validate() from the spec's fields, and safe defaults for the provider-side switches.
// Where it fits: each provider file extends BaseIntegration and writes only its spec and its test()/health(). A shell (no provider code yet) is made by shell().
// Rules: no network here. The default health() runs the provider's own test() and reads it as healthy / down, which is right for the read-only probes we use.

import { allOk, check, validateFields } from "../fields.js";
import type { ConnectionView, GoLiveResult, HealthResult, Integration, IntegrationContext, IntegrationInput, IntegrationSpec, StepDef, TestResult, ValidationResult } from "../types.js";

const filled = (c: ConnectionView) => c.state !== "none" && c.state !== "draft" && c.state !== "in_review" && c.state !== "rejected";
/** The usual checklist: Details entered -> Test passed -> Live. */
export const USUAL_STEPS: readonly StepDef[] = [
  { id: "details", label: { en: "Details entered" }, done: filled },
  { id: "test", label: { en: "Test passed" }, done: (c) => c.state === "test_passed" || c.state === "live" || c.state === "paused" },
  { id: "live", label: { en: "Live" }, done: (c) => c.state === "live" },
];
/** The checklist of a business payment request: a document check comes first. */
export const REVIEWED_STEPS: readonly StepDef[] = [
  { id: "review", label: { en: "Request approved" }, done: (c) => c.reviewStatus === "accepted", wait: (c) => c.reviewStatus === "pending" },
  ...USUAL_STEPS,
];

export abstract class BaseIntegration implements Integration {
  abstract readonly spec: IntegrationSpec;
  get id(): string { return this.spec.id; }
  describe(): IntegrationSpec { return this.spec; }
  validate(input: IntegrationInput): ValidationResult { return validateFields(this.spec.fields, input); }
  abstract test(ctx: IntegrationContext): Promise<TestResult>;
  async goLive(_ctx: IntegrationContext): Promise<GoLiveResult> { return { ok: true, message: "Switched on." }; }
  async pause(_ctx: IntegrationContext): Promise<void> { /* nothing to switch off at the provider */ }
  async health(ctx: IntegrationContext): Promise<HealthResult> {
    try {
      const t = await this.test(ctx);
      return t.ok ? { status: "healthy", message: "Working." } : { status: "down", message: t.checks.find((c) => !c.ok)?.message ?? "The check failed." };
    } catch {
      return { status: "down", message: "Couldn't reach the service." };
    }
  }
}

/** Runs the provider calls of a test and turns a network failure into one plain check (never an exception with a URL or a key in it). */
export async function probe(run: () => Promise<TestResult["checks"]>): Promise<TestResult> {
  let checks: TestResult["checks"];
  try { checks = await run(); }
  catch { checks = [check("Connection", false, "Couldn't reach the service. Check the internet and try again.")]; }
  return { ok: allOk(checks), checks };
}

class Shell extends BaseIntegration {
  constructor(readonly spec: IntegrationSpec) { super(); }
  async test(): Promise<TestResult> {
    return { ok: false, checks: [check("Not available yet", false, `${this.spec.name.en} can be filled in now. Testing and going live arrive when its connection is built.`)] };
  }
  override async health(): Promise<HealthResult> { return { status: "unknown", message: "Not built yet." }; }
}

/** A spec-only integration: its screen, fields, steps and states exist; its provider code does not yet. */
export function shell(spec: Omit<IntegrationSpec, "built" | "steps" | "documents" | "capabilities" | "fallback" | "guide"> & Partial<Pick<IntegrationSpec, "steps" | "documents" | "capabilities" | "fallback" | "guide">>): Integration {
  return new Shell({
    steps: USUAL_STEPS, documents: [], capabilities: [], fallback: "none",
    guide: [{ title: "Coming soon", body: "You can save the details now. Sheetal switches this connection on as soon as it is built; nothing needs to be typed again." }],
    ...spec, built: false,
  });
}
