// The Integration Center's types: one interface for every outside service (INTEGRATIONS.md section 2).
// Where it fits: providers/*.ts implement `Integration`; registry.ts lists them; service.ts drives them; routes.ts and the screens only see `IntegrationSpec`
// and `ConnectionView`, never a secret.
// How it works: describe() is data for the screen; validate() checks shapes with no network; test() and health() call the provider through the injected
// fetch; goLive()/pause() do the provider-side switch when there is one. A provider with no code yet is a "shell" (built: false): its spec, steps and
// states exist, so its keys arriving later need no new screen.
// Rules: a secret is only ever reachable through `ctx.secrets.get(field)`, bound to ONE mode. No provider file reads the database or the vault itself.

export type IntegrationScope = "platform" | "business";
export type Mode = "test" | "live";
export type Fetch = typeof fetch;
export interface Text { en: string; ne?: string }

export type ConnectionState = "draft" | "in_review" | "rejected" | "details_entered" | "test_failed" | "test_passed" | "live" | "paused";
export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";
export type IntegrationGroup = "payments" | "messaging" | "email" | "ai" | "social" | "delivery" | "channels" | "tax" | "web";

export interface IntegrationField {
  key: string;
  label: Text;
  help?: Text;
  required?: boolean;
  /** Sealed, write-only, never returned. */
  secret?: boolean;
  /** For a secret: which modes have their own value. Default: every mode of the spec. */
  modes?: readonly Mode[];
  /** A full-match pattern for the value, with the sentence shown when it does not match. */
  pattern?: string;
  message?: string;
  maxLength?: number;
  options?: readonly { id: string; label: string }[];
  hintLink?: { label: Text; url: string };
}

export interface DocumentDef { key: string; label: Text; required: boolean; filledBy: "owner" | "sheetal"; fileTypes: readonly ("pdf" | "jpg" | "png")[]; maxMB: number; expires?: boolean }
export interface StepDef { id: string; label: Text; done: (c: ConnectionView) => boolean; wait?: (c: ConnectionView) => boolean }
export interface GuideStep { title: string; body: string; links?: readonly { label: string; url: string }[] }

export interface IntegrationSpec {
  id: string;
  name: Text;
  group: IntegrationGroup;
  icon: string;
  /** The scopes this integration is offered to. */
  scopes: readonly IntegrationScope[];
  capabilities: readonly string[];
  modes: readonly Mode[];
  fields: readonly IntegrationField[];
  documents: readonly DocumentDef[];
  steps: readonly StepDef[];
  /** The built-in help guide (English). A published HelpGuide row with key "guide.integration.<id>.<scope>" wins over it. */
  guide: readonly GuideStep[];
  review?: { before: "credentials" | "go_live"; by: "sheetal" };
  requires?: readonly string[];
  fallback: "none" | "platform";
  /** false = a shell: the spec exists, the provider code does not yet. It can be filled in but not tested or switched on. */
  built: boolean;
  /** A note shown on the card (for example "Not used for now"). */
  note?: Text;
}

/** A connection as every caller sees it: no secret values, only which secret fields are filled per mode. */
export interface ConnectionView {
  id: string | null;
  integrationId: string;
  scope: IntegrationScope;
  tenantId: string | null;
  state: ConnectionState | "none";
  mode: Mode;
  config: Record<string, string>;
  stagedConfig: Record<string, string> | null;
  has: { test: string[]; live: string[]; staged: string[] };
  reviewStatus: "none" | "pending" | "accepted" | "rejected";
  reviewNote: string | null;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  pauseReason: string | null;
  health: { status: HealthStatus; message: string | null; checkedAt: Date | null };
  version: number;
}

export interface SecretReader { get(field: string): string | undefined; has(field: string): boolean }
export interface IntegrationLog { warn(o: object, msg?: string): void; info(o: object, msg?: string): void }

export interface IntegrationContext {
  readonly connection: ConnectionView;
  /** The values to use for this call: the active config, or the staged one for a staged test. */
  readonly config: Record<string, string>;
  readonly mode: Mode;
  readonly secrets: SecretReader;
  readonly env: "development" | "test" | "production";
  readonly fetch: Fetch;
  readonly log: IntegrationLog;
  readonly now: Date;
}

export interface Check { name: string; ok: boolean; message: string }
export interface TestResult { ok: boolean; checks: Check[] }
export interface GoLiveResult { ok: boolean; message: string }
export interface HealthResult { status: HealthStatus; message: string }
export interface ValidationResult { ok: boolean; errors: Record<string, string[]> }
export type IntegrationInput = Record<string, string | undefined>;

export interface Integration {
  readonly id: string;
  describe(): IntegrationSpec;
  validate(input: IntegrationInput): ValidationResult;
  test(ctx: IntegrationContext): Promise<TestResult>;
  goLive(ctx: IntegrationContext): Promise<GoLiveResult>;
  pause(ctx: IntegrationContext): Promise<void>;
  health(ctx: IntegrationContext): Promise<HealthResult>;
}
