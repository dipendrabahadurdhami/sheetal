// Tests for the Integration Center's pure parts: the life-cycle, field checks, safe words, the registry, the bound vault format and the six adapters
// (with a fake fetch). No database. The database side is admin/backend/test/integrations.test.ts.
import { describe, expect, it } from "vitest";
import { Vault } from "../src/auth/vault.js";
import { missingFields, safeMessage, validateFields } from "../src/integrations/fields.js";
import { INTEGRATIONS, integrationOf, registryProblems, specsFor } from "../src/integrations/registry.js";
import { TransitionError, healthAfter, next, stagesChanges, usable } from "../src/integrations/state.js";
import type { ConnectionView, Fetch, IntegrationContext, Mode } from "../src/integrations/types.js";

const view = (over: Partial<ConnectionView> = {}): ConnectionView => ({
  id: "c1", integrationId: "x", scope: "platform", tenantId: null, state: "details_entered", mode: "test", config: {}, stagedConfig: null,
  has: { test: [], live: [], staged: [] }, reviewStatus: "none", reviewNote: null, lastTestAt: null, lastTestOk: null, pauseReason: null,
  health: { status: "unknown", message: null, checkedAt: null }, version: 1, ...over,
});
const ctxOf = (o: { config?: Record<string, string>; secrets?: Record<string, string>; mode?: Mode; fetch: Fetch; env?: "development" | "test" | "production" }): IntegrationContext => ({
  connection: view(), config: o.config ?? {}, mode: o.mode ?? "test", env: o.env ?? "test", fetch: o.fetch, now: new Date("2026-11-12T00:00:00Z"),
  secrets: { get: (f) => o.secrets?.[f], has: (f) => !!o.secrets?.[f] }, log: { warn: () => {}, info: () => {} },
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fake = (answer: (url: string, init?: RequestInit) => Response) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return answer(String(url), init); }) as Fetch;
  return { fetchFn, calls };
};

describe("vault v2 (bound values)", () => {
  const vault = new Vault("a-test-secret-key-that-is-long-enough-000", false);
  it("opens a bound value only at its own place", () => {
    const sealed = vault.seal("live-key-123", "c1:live:secretKey");
    expect(sealed.startsWith("v2:")).toBe(true);
    expect(vault.open(sealed, "c1:live:secretKey")).toBe("live-key-123");
    expect(() => vault.open(sealed, "c1:test:secretKey")).toThrow();     // a live key copied into the test set does not open
    expect(() => vault.open(sealed, "c2:live:secretKey")).toThrow();     // nor in another connection
    expect(() => vault.open(sealed)).toThrow();
  });
  it("still opens every old (v1) value, with or without a place", () => {
    const old = vault.seal("old-key");
    expect(old.startsWith("v1:")).toBe(true);
    expect(vault.open(old)).toBe("old-key");
    expect(vault.open(old, "c1:live:secretKey")).toBe("old-key");
  });
});

describe("life-cycle", () => {
  it("details entered -> test -> go live -> pause -> resume", () => {
    expect(next({ state: "none", action: "save", complete: false })).toBe("draft");
    expect(next({ state: "draft", action: "save", complete: true })).toBe("details_entered");
    expect(next({ state: "details_entered", action: "test", ok: false })).toBe("test_failed");
    expect(next({ state: "test_failed", action: "test", ok: true })).toBe("test_passed");
    const now = new Date("2026-11-12T00:00:00Z");
    expect(next({ state: "test_passed", action: "go_live", lastTestOk: true, lastTestAt: new Date("2026-11-10T00:00:00Z"), now })).toBe("live");
    expect(next({ state: "live", action: "pause" })).toBe("paused");
    expect(next({ state: "paused", action: "resume" })).toBe("live");
  });
  it("a changed field resets a passed test; a change to a live connection is staged and moves nothing", () => {
    expect(next({ state: "test_passed", action: "save", complete: true })).toBe("details_entered");
    expect(next({ state: "live", action: "save", complete: true })).toBe("live");
    expect(stagesChanges("live")).toBe(true);
    expect(stagesChanges("paused")).toBe(true);
    expect(stagesChanges("test_passed")).toBe(false);
  });
  it("refuses going live without a fresh passing test, and testing a draft", () => {
    const now = new Date("2026-11-12T00:00:00Z");
    expect(() => next({ state: "details_entered", action: "go_live", now })).toThrow(TransitionError);
    expect(() => next({ state: "test_passed", action: "go_live", lastTestOk: true, lastTestAt: new Date("2026-11-01T00:00:00Z"), now })).toThrow(/older than 7 days/);
    expect(() => next({ state: "draft", action: "test", ok: true })).toThrow(/Enter the details first/);
    expect(() => next({ state: "draft", action: "pause" })).toThrow(TransitionError);
  });
  it("a business payment request waits for a document check before its details count", () => {
    expect(next({ state: "draft", action: "save", complete: true, needsReview: true })).toBe("draft");
    expect(next({ state: "draft", action: "submit", needsReview: true })).toBe("in_review");
    expect(() => next({ state: "in_review", action: "save", complete: true })).toThrow(/being reviewed/);
    expect(next({ state: "in_review", action: "reject" })).toBe("rejected");
    expect(next({ state: "rejected", action: "submit", needsReview: true })).toBe("in_review");
    expect(next({ state: "in_review", action: "approve" })).toBe("draft");
  });
  it("usable: live and not down; test details work outside production only", () => {
    expect(usable({ state: "live", mode: "live", health: "healthy" }, "production")).toBe(true);
    expect(usable({ state: "live", mode: "live", health: "down" }, "production")).toBe(false);
    expect(usable({ state: "paused", mode: "live", health: "healthy" }, "production")).toBe(false);
    expect(usable({ state: "details_entered", mode: "test", health: "unknown" }, "development")).toBe(true);
    expect(usable({ state: "details_entered", mode: "test", health: "unknown" }, "production")).toBe(false);
  });
  it("health: three failures in a row = down, told once; the first success clears it", () => {
    let h = { status: "healthy" as const, failures: 0 } as { status: "healthy" | "degraded" | "down" | "unknown"; failures: number };
    const step = (p: "healthy" | "down") => { const r = healthAfter(h, p); h = { status: r.status, failures: r.failures }; return r.alert; };
    expect(step("down")).toBeNull(); expect(h.status).toBe("degraded");
    expect(step("down")).toBeNull();
    expect(step("down")).toBe("down"); expect(h.status).toBe("down");
    expect(step("down")).toBeNull();                                   // not told twice
    expect(step("healthy")).toBe("back"); expect(h).toEqual({ status: "healthy", failures: 0 });
  });
});

describe("fields and safe words", () => {
  const esewa = integrationOf("esewa")!.describe();
  it("checks shapes with the provider's own sentences and refuses unknown fields", () => {
    expect(validateFields(esewa.fields, { productCode: "MY_SHOP", secretKey: "abc" }).ok).toBe(true);
    expect(validateFields(esewa.fields, { productCode: "a b" }).errors.productCode).toEqual(["A product code is 3 to 40 letters and digits."]);
    expect(validateFields(esewa.fields, { colour: "red" }).errors.colour).toBeTruthy();
    expect(validateFields(integrationOf("google")!.describe().fields, { measurementId: "UA-1" }).errors.measurementId).toEqual(["A Google Analytics id looks like G-ABC123XYZ."]);
  });
  it("knows what is still missing for one mode", () => {
    expect(missingFields(esewa.fields, {}, [], "test")).toEqual(["productCode", "secretKey"]);
    expect(missingFields(esewa.fields, { productCode: "X1Y" }, ["secretKey"], "test")).toEqual([]);
  });
  it("never lets a key through in a message", () => {
    const key = "live_secret_key_9f8e7d6c5b4a39281706";
    const out = safeMessage(`Invalid token ${key} for merchant`, [key]);
    expect(out).not.toContain(key);
    expect(safeMessage("x".repeat(500)).length).toBeLessThanOrEqual(200);
    expect(safeMessage("Bearer abcdefghijklmnopqrstuvwxyz0123456789 refused")).not.toMatch(/abcdefghijklmnopqrstuvwxyz/);
  });
});

describe("registry", () => {
  it("is consistent and offers the right things to each scope", () => {
    expect(registryProblems()).toEqual([]);
    expect(INTEGRATIONS.filter((i) => i.describe().built).map((i) => i.id).sort()).toEqual(["ai.anthropic", "ai.gemini", "ai.openai", "cloudflare", "esewa", "fonepay", "google", "khalti", "voice.elevenlabs", "whatsapp"]); // AI built in P3-BE-8
    const biz = specsFor("business").map((s) => s.id);
    expect(biz).toContain("esewa"); expect(biz).toContain("delivery.pathao"); expect(biz).toContain("tax.cbms");
    expect(biz).not.toContain("cloudflare"); expect(biz).not.toContain("google");
    expect(specsFor("platform").map((s) => s.id)).not.toContain("delivery.pathao");
  });
  it("payments never fall back to Sheetal's own account", () => {
    for (const id of ["esewa", "khalti", "fonepay", "fonepay_qr", "card"]) expect(integrationOf(id)!.describe().fallback, id).toBe("none");
  });
  it("a shell can be described but not tested or switched on", async () => {
    const pathao = integrationOf("delivery.pathao")!;
    expect(pathao.describe().built).toBe(false);
    const r = await pathao.test(ctxOf({ fetch: fake(() => json(200, {})).fetchFn }));
    expect(r.ok).toBe(false);
  });
});

describe("adapters (fake fetch)", () => {
  it("eSewa: a known product code passes on the test host; the public test merchant is refused in production", async () => {
    const f = fake(() => json(200, { status: "NOT_FOUND" }));
    const ok = await integrationOf("esewa")!.test(ctxOf({ config: { productCode: "MYSHOP" }, secrets: { secretKey: "k" }, fetch: f.fetchFn }));
    expect(ok.ok).toBe(true);
    expect(f.calls[0]!.url.startsWith("https://rc.esewa.com.np/")).toBe(true);
    const bad = await integrationOf("esewa")!.test(ctxOf({ config: { productCode: "NOPE" }, secrets: { secretKey: "k" }, fetch: fake(() => json(400, { error_message: "Invalid product code" })).fetchFn }));
    expect(bad.ok).toBe(false);
    const g = fake(() => json(200, { status: "NOT_FOUND" }));
    const prod = await integrationOf("esewa")!.test(ctxOf({ config: { productCode: "EPAYTEST" }, secrets: { secretKey: "k" }, fetch: g.fetchFn, env: "production" }));
    expect(prod.ok).toBe(false);
    expect(g.calls).toHaveLength(0);
  });
  it("Khalti: 401 = bad key, a 'not found' answer = key accepted; live uses the live host", async () => {
    const bad = await integrationOf("khalti")!.test(ctxOf({ secrets: { secretKey: "wrong_key_wrong_key_wrong_key" }, fetch: fake(() => json(401, { detail: "Invalid token wrong_key_wrong_key_wrong_key." })).fetchFn }));
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad.checks)).not.toContain("wrong_key_wrong_key_wrong_key");
    const f = fake(() => json(404, { detail: "Not found." }));
    const ok = await integrationOf("khalti")!.test(ctxOf({ secrets: { secretKey: "good" }, mode: "live", fetch: f.fetchFn }));
    expect(ok.ok).toBe(true);
    expect(f.calls[0]!.url).toBe("https://khalti.com/api/v2/epayment/lookup/");
    expect((f.calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Key good");
  });
  it("Fonepay: signs the question and reads the XML answer", async () => {
    const f = fake(() => new Response("<response><success>false</success><message>Transaction not found</message></response>", { status: 200 }));
    const ok = await integrationOf("fonepay")!.test(ctxOf({ config: { merchantCode: "NBQM" }, secrets: { secretKey: "s3cr3t" }, fetch: f.fetchFn }));
    expect(ok.ok).toBe(true);
    expect(f.calls[0]!.url).toMatch(/^https:\/\/dev-clientapi\.fonepay\.com\/.*DV=[0-9a-f]{128}/);
    const bad = await integrationOf("fonepay")!.test(ctxOf({ config: { merchantCode: "NBQM" }, secrets: { secretKey: "s3cr3t" }, fetch: fake(() => new Response("Invalid merchant", { status: 400 })).fetchFn }));
    expect(bad.ok).toBe(false);
  });
  it("Google: the Maps key is checked; ids are only 'saved'", async () => {
    const r = await integrationOf("google")!.test(ctxOf({ config: { measurementId: "G-ABC123XYZ" }, secrets: { mapsKey: "AIzaKey" }, fetch: fake(() => json(200, { status: "OK" })).fetchFn }));
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(["Analytics id", "Maps key"]);
    const none = await integrationOf("google")!.test(ctxOf({ fetch: fake(() => json(200, {})).fetchFn }));
    expect(none.checks[0]!.message).toBe("Save at least one Google value first.");
  });
  it("WhatsApp: reads the phone number with the token", async () => {
    const f = fake(() => json(200, { display_phone_number: "+977 980-0000000", verified_name: "Sheetal Property" }));
    const r = await integrationOf("whatsapp")!.test(ctxOf({ config: { phoneId: "123456789" }, secrets: { token: "EAAG" }, mode: "live", fetch: f.fetchFn }));
    expect(r.checks[0]).toEqual({ name: "WhatsApp Cloud API", ok: true, message: "Connected to Sheetal Property (+977 980-0000000)." });
    expect(f.calls[0]!.url).toContain("graph.facebook.com/v21.0/123456789");
  });
  it("Cloudflare: token verify, then the zone; a dead network is one plain check", async () => {
    const f = fake((url) => (url.endsWith("/verify") ? json(200, { success: true }) : json(200, { result: { name: "sheetalproperty.com" } })));
    const r = await integrationOf("cloudflare")!.test(ctxOf({ config: { zoneId: "a".repeat(32) }, secrets: { apiToken: "t" }, mode: "live", fetch: f.fetchFn }));
    expect(r.ok).toBe(true);
    expect(r.checks[1]!.message).toBe("Found sheetalproperty.com.");
    const dead = (async () => { throw new Error("getaddrinfo ENOTFOUND api.cloudflare.com token=t"); }) as unknown as Fetch;
    const down = await integrationOf("cloudflare")!.test(ctxOf({ secrets: { apiToken: "t" }, mode: "live", fetch: dead }));
    expect(down).toEqual({ ok: false, checks: [{ name: "Connection", ok: false, message: "Couldn't reach the service. Check the internet and try again." }] });
    expect((await integrationOf("cloudflare")!.health(ctxOf({ secrets: { apiToken: "t" }, mode: "live", fetch: dead }))).status).toBe("down");
  });
});

describe("AI providers (P3-BE-8)", () => {
  const KEY = "sk-test-ABCDEFGHIJKLMNOPQRSTUVWX-123";
  it("test() is a one-token completion with the key only in a header", async () => {
    const f = fake(() => json(200, { model: "claude-x", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 5, output_tokens: 1 } }));
    const r = await integrationOf("ai.anthropic")!.test(ctxOf({ secrets: { apiKey: KEY }, mode: "live", fetch: f.fetchFn }));
    expect(r.ok).toBe(true);
    expect(f.calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(f.calls[0]!.url).not.toContain(KEY);
    expect((f.calls[0]!.init?.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
  });
  it("a refused key fails the test with the key hidden, for every text provider", async () => {
    for (const id of ["ai.anthropic", "ai.openai", "ai.gemini"]) {
      const f = fake((url) => json(401, { error: { message: `Incorrect API key provided: ${KEY}` } , url }));
      const r = await integrationOf(id)!.test(ctxOf({ secrets: { apiKey: KEY }, mode: "live", fetch: f.fetchFn }));
      expect(r.ok, id).toBe(false);
      expect(JSON.stringify(r), id).not.toContain(KEY);
      for (const c of f.calls) expect(c.url, id).not.toContain(KEY);
    }
  });
  it("ElevenLabs tests the key with the voices list and checks the voice id", async () => {
    const f = fake(() => json(200, { voices: [{ voice_id: "abcdEFGH1234" }] }));
    const r = await integrationOf("voice.elevenlabs")!.test(ctxOf({ secrets: { apiKey: KEY }, config: { voiceId: "nope1234" }, mode: "live", fetch: f.fetchFn }));
    expect(r.checks.map((c) => [c.name, c.ok])).toEqual([["API key", true], ["Voice", false]]);
  });
  it("no key, no call", async () => {
    const f = fake(() => json(200, {}));
    expect((await integrationOf("ai.openai")!.test(ctxOf({ mode: "live", fetch: f.fetchFn }))).ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
});
