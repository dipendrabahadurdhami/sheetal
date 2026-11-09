# Integration Center

Status: design for Phase 1 (task P1-ARCH-1). Nothing here is built yet.
Companions: [SETTINGS.md](SETTINGS.md) (field and document definitions are the same format), [ACCESS.md](ACCESS.md) (who may do what),
[KERNEL.md](KERNEL.md) (context, events).

The decision (TEAM-RULES): every outside service is **built in advance** and switched on from a screen:
**details entered → test → test passed → live (public) → paused.** Platform-level ones are set up by the super admin; a business's own
accounts by its owner. Each has required fields and documents, a step-by-step help guide with links, a test log and a health
status. **Credentials arriving later never need a code change.**

What I read: `lib/payments.ts`, `lib/vault.ts`, `lib/secrets.ts`, `domain/billing.ts` (`gateways()`), `domain/platform.ts`,
`admin/backend/.../platform.ts`, `shared/src/data/integrations.js`, `AdminIntegrations.jsx`, `config.ts`.
Not given: `lib/ai.ts`, `LiveIntegrations.jsx`, `LiveSetup.jsx`, the OTA/channels code, the billing `Payment` model. Where the
design depends on them I say so.

---

## 1. What exists today

| Piece | Where | What it does | Problem |
|---|---|---|---|
| eSewa / Khalti / Fonepay | `lib/payments.ts` | `checkout` and `verify` functions per provider, `Mode = "test" \| "live"`, `ESEWA_TEST` public test merchant | code is fine; configuration is not a general concept |
| Gateway keys | `domain/billing.ts` `gateways()` | reads `AppSetting "payments"`: `{enabled, mode, productCode, secretKey (sealed)}`; test merchant works outside production | one mode per gateway, no test log, no states |
| Google / WhatsApp / Cloudflare | `domain/platform.ts`, `admin/.../platform.ts` | `AppSetting "integration.<id>"`: values + sealed secret fields + `lastTest`; status "off / in review / done" worked out from the values; `PUT` and `POST …/test` | three hard-coded ids, test logic is an `if` chain, no live/pause |
| Setup center | `AdminIntegrations.jsx`, `shared/src/data/integrations.js` | cards for email, WhatsApp, Meta, Google, AI, payments, channels, SMS with step lists | mostly **sample** screens on `localStorage`; the real ones are three small forms |
| AI keys | `lib/ai.ts` (not given), `AI_PROVIDERS` list | Sheetal's key; "businesses may use their own" flag | not part of any common model |
| Vault | `lib/vault.ts` | AES-256-GCM, key from `SECRETS_KEY`, values `v1:<iv>:<tag>:<ciphertext>` | good; needs a way to bind a value to its place and to rotate the key |

---

## 2. The `Integration` interface

One TypeScript interface for all of them. Folder: `platform/src/integrations/`.

```ts
export type IntegrationScope = "platform" | "business";
export type Mode = "test" | "live";                         // the same Mode as lib/payments.ts

export interface Integration {
  /** Stable id: "esewa", "khalti", "whatsapp", "ai.anthropic", "delivery.pathao"… Lower-case, dots allowed. */
  readonly id: string;

  /** Everything a screen needs to draw the set-up: fields, documents, steps, help. No network. */
  describe(scope: IntegrationScope): IntegrationSpec;

  /** Checks the SHAPE of what was typed (formats, required, lengths). No network. Same messages the forms show today. */
  validate(input: IntegrationInput, scope: IntegrationScope): ValidationResult;

  /** Calls the provider in the connection's current mode and checks that the details work. Never moves money. */
  test(ctx: IntegrationContext): Promise<TestResult>;

  /** Provider-side switch-on, if any (register a webhook, subscribe a page). Called by "Go live", after a successful test. */
  goLive(ctx: IntegrationContext): Promise<GoLiveResult>;

  /** Provider-side switch-off, if any (remove the webhook). Credentials are kept. Safe to call twice. */
  pause(ctx: IntegrationContext): Promise<void>;

  /** A cheap, read-only probe used by the health job. Never moves money, never sends a customer message. */
  health(ctx: IntegrationContext): Promise<HealthResult>;

  /** Optional: undo goLive and forget provider-side state when a connection is removed. */
  disconnect?(ctx: IntegrationContext): Promise<void>;
}

export interface IntegrationSpec {
  id: string;
  name: Text;                                   // { en, ne }
  group: "payments" | "messaging" | "email" | "ai" | "social" | "delivery" | "channels" | "tax" | "web";
  icon: string;
  scope: IntegrationScope;
  /** What the rest of the platform can ask of it: "payments.checkout", "messages.send", "ai.complete", "tax.submit_invoice"… */
  capabilities: readonly string[];
  /** ["test","live"] for providers with a sandbox; ["live"] when there is none (then "test" is a read-only probe). */
  modes: readonly Mode[];
  fields: readonly IntegrationField[];
  documents: readonly DocumentDef[];
  steps: readonly StepDef[];                    // the checklist on the screen (see §4.3)
  guideKey: string;                             // "guide.integration.esewa.business" → a HelpGuide (§8)
  /** A human check before credentials are accepted (business payment requests). */
  review?: { before: "credentials" | "go_live"; by: "sheetal" };
  /** If another connection must be live first (WhatsApp needs the Meta app; email needs Cloudflare). */
  requires?: readonly string[];
  /** What to use when this business has no live connection of its own. */
  fallback: "none" | "platform";
  /** Provider webhooks this integration receives, so the registry can route them. */
  webhooks?: readonly { path: string; verify: "signature" | "token" }[];
  /** Public test values that work outside production only (eSewa's EPAYTEST merchant). */
  testDefaults?: { values: Record<string, string>; allowedIn: readonly ("development" | "test")[] };
}

/** The field format is the one in SETTINGS.md §5, plus: */
export interface IntegrationField extends FieldDef {
  secret?: boolean;                             // sealed, write-only, never returned
  modes?: readonly Mode[];                      // which mode this field belongs to ("secretKey" has a test value and a live value). Default: both modes share it.
  hintLink?: { label: Text; url: string };      // "Where do I find this?"
}

export interface DocumentDef {
  key: string;                                  // "pan_certificate"
  label: Text;
  help?: Text;
  required: boolean;
  filledBy: "owner" | "sheetal";                // who uploads it
  fileTypes: readonly ("pdf" | "jpg" | "png")[];
  maxMB: number;
  expires?: boolean;                            // ask for an expiry date (a licence)
}

export interface StepDef { id: string; label: Text; done: (c: ConnectionView) => boolean; wait?: (c: ConnectionView) => boolean }  // evaluated on the server; the screen gets booleans

export interface IntegrationContext {
  readonly connection: ConnectionView;          // id, integrationId, scope, tenantId, state, mode, config (non-secret values)
  readonly mode: Mode;                          // the connection's current mode, or the mode of a staged test
  readonly secrets: SecretReader;               // get("secretKey") opens ONE field of THIS mode only. There is no way to read the other mode.
  readonly documents: readonly DocumentView[];
  readonly env: "development" | "test" | "production";
  readonly fetch: Fetch;                        // timeout 10 s, injected so tests use a fake (like admin/.../platform.ts does)
  readonly log: FastifyBaseLogger;
  readonly now: Date;
  readonly actor: Actor;
}

export interface TestResult   { ok: boolean; checks: { name: string; ok: boolean; message: string }[] }   // the shape /settings/integrations/:id/test returns today
export interface GoLiveResult { ok: boolean; message: string }
export interface HealthResult { status: "healthy" | "degraded" | "down" | "unknown"; message: string }
```

### 2.1 Capability interfaces

A provider implements `Integration` **and** the capability interfaces the apps use. Apps depend on the capability, never on a provider.

```ts
export interface PaymentProvider extends Integration {
  checkout(ctx: IntegrationContext, o: { amount: Money; ref: string; name: string; successUrl: string; failureUrl: string; customer?: Customer }): Promise<Checkout>;   // Checkout = the type in lib/payments.ts
  verify(ctx: IntegrationContext, o: { ref: string; amount: Money; payload: unknown }): Promise<Verified>;                                                          // Verified = the type in lib/payments.ts
}
export interface MessageChannel extends Integration { send(ctx: IntegrationContext, m: OutboundMessage): Promise<SendResult>; parseInbound(req: RawRequest, ctx: IntegrationContext): InboundMessage[] }
export interface AiProvider extends Integration { complete(ctx: IntegrationContext, r: AiRequest): Promise<AiResponse>; models(): readonly string[] }
export interface DeliveryPartner extends Integration { quote(...); createOrder(...); track(...) }                   // shape fixed when the first partner pack arrives
export interface ChannelManager extends Integration { pullCalendar(...); pushAvailability(...) }                    // today's iCal sync, later partner APIs
export interface TaxReporter extends Integration { submitInvoice(ctx: IntegrationContext, invoice: TaxInvoice): Promise<TaxReceipt> }   // IRD / CBMS
```

The existing functions `esewaCheckout`, `esewaVerify`, `khaltiCheckout`, `khaltiVerify`, `fonepayCheckout`, `fonepayVerify` are **kept as they are**
(they are tested and the signatures are right). `EsewaProvider` etc. are thin classes that call them. Amounts: `Money` at the edge,
`toRupeesWhole()` into the existing functions, which still take whole rupees.

### 2.2 How apps use it

```ts
const pay  = await integrations.paymentProvider(ctx, "esewa");        // PaymentProvider | null
if (!pay) throw badRequest("eSewa isn't available for this business.");
const co   = await pay.checkout(...);
```

`integrations.resolve(ctx, id)` returns the **usable** connection:

```
usable(connection, env) =
     connection.state == "live" AND health != "down"
  OR (env != "production" AND connection.mode == "test" AND connection.state in {details_entered, test_passed})     // keeps today's "try it locally" behaviour
```

Business request: its own `business` connection if usable; otherwise, **only if the spec says `fallback: "platform"`**, the platform
one; otherwise `null`. Payments are `fallback: "none"`: a business's money must never go through Sheetal's merchant account by accident.
AI and WhatsApp are `fallback: "platform"` (the "Sheetal AI subscription" and Sheetal's number), but only when the business's entitlement
allows it (`ctx.entitlements.ai(appId) === "sheetal"`).

---

## 3. Scope: platform and business

| | Platform-level | Business-level |
|---|---|---|
| Whose account | Sheetal's | the business's own |
| Used for | Sheetal subscriptions, website payments, rent of properties **Sheetal manages**, system messages, Sheetal AI, Google/Meta/Cloudflare | that business's own apps: its invoices, POS, rent of properties **it manages itself**, its WhatsApp number, its AI key, its delivery and OTA accounts, its tax reporting |
| Set up by | super admin (`platform.integration.manage`) | the business owner (`workspace.integration.manage`, held by owners only at first) |
| Seen by staff | status, health, test log, documents of business requests (`platform.integration.read` / `.review`) | – |
| Stored with | `tenantId = null` | `tenantId = business id` |

One integration can have both scopes (eSewa: Sheetal's own merchant **and** each business's merchant). They are two separate connections
with separate secrets. `unique (integrationId, scope, tenantId)`.

---

## 4. The life-cycle

### 4.1 States

| State | Meaning | Stored? |
|---|---|---|
| `draft` | Started. Required details or documents still missing. (No row = "not set up".) | yes |
| `in_review` | Only when the spec asks for a human check: documents submitted, waiting for Sheetal staff. Documents are locked. | yes |
| `rejected` | Staff refused (with a note). The owner fixes and resubmits → `in_review`. | yes |
| `details_entered` | Everything required is present and passes `validate()`. Credentials saved. Ready to test. | yes |
| `test_failed` | The last test failed. Fields stay editable. The log shows why. | yes |
| `test_passed` | The last test passed **on the current details**. Ready to go live. | yes |
| `live` | Switched on. The platform or the business's apps use it ("public"). | yes |
| `paused` | Switched off on purpose. Details kept. Apps behave as if it is not connected. | yes |

**Health is not a state.** It is a second flag (`healthy / degraded / down / unknown`) updated by the health job (§12). A live integration
can be down; it then stops being *usable* (§2.2) and people are told, but nobody's choice is overwritten.

### 4.2 Transitions

| From | Action | To | Who | Guard |
|---|---|---|---|---|
| – | start | `draft` | platform: super admin · business: owner | the integration is offered to this scope (spec) and, for business scope, the business's plan/app allows it |
| `draft` | save details | `draft` / `details_entered` | same | `validate()` passes and all required fields and documents exist. If `spec.review.before = "credentials"` and documents are done, the next stop is `in_review`, not `details_entered` |
| `draft` | submit for review | `in_review` | owner | all required documents uploaded (types and sizes checked by bytes) |
| `in_review` | approve | `draft` (credentials unlocked) | staff with `platform.integration.review` | every document accepted |
| `in_review` | reject | `rejected` | same | a note is required |
| `rejected` | resubmit | `in_review` | owner | changed documents |
| `details_entered`, `test_failed`, `test_passed` | test | `test_passed` / `test_failed` | same as start | runs `test()` in `mode = "test"` (or the only mode); writes a log row; a changed field resets `test_passed` to `details_entered` |
| `test_passed` | go live | `live` | same as start | live-mode secrets exist; the last passing test is no older than 7 days on the current details; `spec.review.before = "go_live"` is accepted if set; `requires` are live; then `goLive()` returns ok. For payments: a read-only live probe passes. Connection `mode` becomes `live`. |
| `live` | pause | `paused` | same, **or staff** with `platform.integration.manage` for a business connection (abuse, chargeback) | `pause()`; reason is required and shown to the owner |
| `paused` | resume | `live` | same | a quick `health()` is not `down` |
| `live`, `paused` | change details | same state, **staged** | same | see §6.3: the change waits in a staged copy until it passes a test, then "Apply" swaps it in. Nothing live is broken by a typo. |
| any | disconnect | `draft` (details removed) | same | nothing in flight (pending payments, open orders); audited |

Every transition writes one audit row `integration.<id>.<action>` with the old and new state, scope, business, actor, and the
reason where asked. Field changes list **names only**, never values (as `settings.integration.<id>` does today: "key replaced").

### 4.3 Steps shown on the screen

The checklist that `stepsOf()` builds on the client today is built on the server from `spec.steps`, and returns `{ id, label, done, wait }`.
Typical steps for a payment gateway: Request approved → Details entered → Test passed → Live.
WhatsApp keeps its richer list (Meta app, number, token, webhook, display-name review, templates, test message): `wait` marks
steps that depend on Meta or DNS, as `wait` does in `integrations.js`.

---

## 5. Data model

For the Database specialist (task P1-DB-4). Names follow the existing style; `/// @app workspace` tags go on them.

```
IntegrationConnection
  id, integrationId, scope ("platform"|"business"), tenantId?  → unique (integrationId, scope, tenantId)
  state, mode ("test"|"live"),
  config Json                       non-secret values of the ACTIVE details       e.g. { productCode, phoneId, zoneId, measurementId }
  stagedConfig Json?                non-secret values waiting to be applied
  reviewStatus ("none"|"pending"|"accepted"|"rejected"), reviewedBy?, reviewedAt?, reviewNote?
  lastTestAt?, lastTestOk?
  goLiveAt?, goLiveBy?, pausedAt?, pausedBy?, pauseReason?
  healthStatus, healthMessage?, healthCheckedAt?, healthFailures Int @default(0), healthAlertedAt?
  version Int, createdAt, updatedAt, createdBy

IntegrationSecretSet
  id, connectionId, mode ("test"|"live"), status ("active"|"staged"|"retired"),
  sealed Json                       { fieldName: "v2:…sealed…" }  one sealed value per secret field
  fieldNames Json                   ["secretKey"] names only, for the "has" flags
  createdAt, createdBy, testedAt?, testOk?
  unique (connectionId, mode, status) where status in ('active','staged')

IntegrationDocument
  id, connectionId, key, fileRef (platform/files private), mime, bytes, expiresOn?,
  status ("pending"|"accepted"|"rejected"), note?, uploadedBy, uploadedAt, reviewedBy?, reviewedAt?

IntegrationTestLog
  id, connectionId, kind ("test"|"live_probe"|"go_live"|"health"), mode, ok, checks Json, durationMs, actorId?, requestId?, at
  (keep the last 200 per connection; health rows 30 days)

HelpGuide
  key, lang ("en"|"ne"), title, steps Json, status ("draft"|"published"), version, updatedBy, updatedAt    unique (key, lang)
```

Other tables a payment provider writes (the billing `Payment` model, not given to me) gain `mode` (`test|live`), so test payments never
mix with real revenue in the reports (SETTINGS.md §7).

---

## 6. Credentials

### 6.1 Sealed with the existing vault

Secrets use `Vault` from `lib/vault.ts` (AES-256-GCM, `SECRETS_KEY`). One sealed value per secret field, kept as a JSON map in
`IntegrationSecretSet.sealed`. This is the same per-field sealing used today, so the migration can **copy the existing sealed strings
without opening them** (§9).

Small, additive hardening of the vault (recommended, task P1-BE-8):

```ts
seal(plain: string, aad?: string): string;      // aad = `${connectionId}:${mode}:${field}`  → written as "v2:<iv>:<tag>:<data>"
open(sealed: string, aad?: string): string;     // reads "v1" (no aad) and "v2" (aad must match)
```

Why: today anyone with write access to the database could copy one sealed value into another row (for example a test key into a
live row). With the binding, that fails to open. `v1` values keep working; new writes are `v2`.

Key rotation (follow-up, not Phase 1): add `SECRETS_KEY_PREVIOUS` to the config; `open` tries the current key then the previous;
a job `vault.reseal` rewrites every sealed value with the new key; then the previous key is removed.

### 6.2 Test and live are kept apart

- Two secret sets per connection: `mode = "test"` and `mode = "live"`. They are separate rows, saved by separate requests.
- `ctx.secrets` is **bound to the mode of the call**. A test run can only read test secrets; there is no API to read the other set.
- The screen shows two tabs, "Test details" and "Live details"; live details cannot be saved until the test details have passed once (except for
  providers with `modes: ["live"]`, which have only the live set and use a read-only probe as the test).
- Test mode uses the provider's sandbox hosts (`ESEWA`, `KHALTI`, `FONEPAY` already have `test` and `live` URL sets in `lib/payments.ts`).
- The eSewa public test merchant (`ESEWA_TEST`) becomes the spec's `testDefaults` with `allowedIn: ["development", "test"]`, the same rule as now.

### 6.3 Never leaked

1. Secret fields are **write-only**: the API returns `has: { test: ["secretKey"], live: [] }` (the `hasMapsKey` pattern), never a value, never a hint of its length.
2. Not in logs (the logger already redacts `*.secret`, `*.token`; add `*.secretKey`, `*.apiKey`, `*.password` and `authorization`), not in audit rows, not in
   test-log `checks[].message` (messages are written by the adapter from fixed text plus the provider's short error, cut to 200 characters; a redaction
   function removes anything that looks like a key before it is saved).
3. Sheetal staff, including `support` while impersonating, cannot see or change a business's secrets (ACCESS.md §12 deny list).
4. Staged change: editing a live or paused connection writes a **staged** secret set and `stagedConfig`. "Test staged" runs `test()` against the staged values; if it passes,
   "Apply" promotes it (the old set becomes `retired`, kept 30 days for a quick rollback, then deleted). This is how a live eSewa key is renewed with no downtime.
5. Rate limits: save 20/hour, test 10/hour per connection. Tests have a 10-second timeout per call and never follow redirects to another host.
6. Endpoints are fixed in code per provider. The only user-supplied URLs are OTA calendar links; those must be `https`, on an allow-list of provider hosts, and must not
   resolve to a private address.

---

## 7. Help guides as editable content

Each integration has a step-by-step guide, in English and Nepali, with links ("Open the Meta developer page", "Open eSewa merchant sign-up").
Guides are **content, not code**: the super admin edits them in Admin → Content (permission `platform.content.update`, publish with `platform.content.publish`).

- Table `HelpGuide` (§5). `key = guide.integration.<id>.<scope>`.
- A guide is an ordered list of steps `{ title, body, links: [{ label, url }], image? }`. `body` is a small Markdown subset (paragraph, bold, list, link); it goes through the same
  allow-list sanitizer the blog uses, never raw HTML.
- Default guides are committed in the repo (`platform/src/integrations/guides/<id>.<scope>.<lang>.md`) and loaded into the table the first time. A published edit in the
  database wins over the file.
- On the integration screen, the guide opens in a side panel next to the fields; each guide step can point at a spec step (`stepId`), so "Webhook" shows the webhook instructions.
- If a guide is missing for a language, the English one shows with a small "English only" note.

I did not see a CMS table, so `HelpGuide` is its own small table. Alternative: store guides as CMS pages; it saves a table but ties the Integration Center to the CMS.

---

## 8. Documents

Needed mainly for business payment requests ("integrated eSewa/Khalti/Fonepay/card after a **document-checked** request"), also tax reporting (IRD/CBMS).

- Definitions are `DocumentDef` in the spec (so they are data, editable by the super admin through the **field builder**, SETTINGS.md §5, which can override
  `required`, `label`, `fileTypes` and add documents per integration).
- Upload goes through `platform/files` private storage; the type is checked by its bytes and the size against `maxMB`; the file is never public. Staff open it through
  a download route that checks `platform.integration.review` and writes an audit row (`integration.document_opened`).
- Staff review each document: accept, or reject with a note. All accepted → "Approve" is possible. The owner is notified at each decision (`notify`).
- Document lists below are **examples for the owner to confirm**; I do not know each provider's real merchant-onboarding checklist:

| Integration (business scope) | Documents (example) |
|---|---|
| eSewa, Khalti, Fonepay, Fonepay QR, card gateway | Company registration, PAN/VAT certificate, signatory's citizenship, bank account proof (cancelled cheque or bank letter), shop/business photo, the merchant agreement or merchant-id letter from the provider |
| IRD / CBMS | PAN certificate, VAT registration, IRD approval for the billing software or CBMS credentials letter |
| Delivery partners | Business registration, PAN, signatory ID |

---

## 9. Where today's code fits

| Today | Becomes | How the data/behaviour is kept |
|---|---|---|
| `lib/payments.ts` | `platform/src/payments/{esewa,khalti,fonepay}.ts` functions (unchanged) + `EsewaProvider`, `KhaltiProvider`, `FonepayProvider` (`PaymentProvider`) in `platform/src/integrations/providers/` | tests move with it unchanged; the providers add `describe/validate/test/health` |
| `billing.ts` `gateways()` reading `AppSetting "payments"` | stays as a function with the same return type (`Gateways`), now reading the platform connections of eSewa/Khalti/Fonepay through `integrations.resolve`. `manual` (bank transfer) stays a platform setting `payments.manual.enabled`; its bank details stay in the billing settings | callers do not change |
| `domain/platform.ts` `integration.google/whatsapp/cloudflare`, `SECRET_FIELDS`, `integrationSettings()`, `saveIntegration()`, `publicSite()` | provider classes `GoogleIntegration`, `WhatsappIntegration`, `CloudflareIntegration`; `SECRET_FIELDS` becomes `secret: true` on fields; the `zod` BODIES become field `pattern` + `message` (same texts: "A Google Analytics id looks like G-ABC123XYZ.", "A zone id is 32 letters and numbers (a–f, 0–9).", …); `publicSite()` reads `integrations.config("google")` | the test logic in `admin/.../platform.ts` (Maps geocode call, WhatsApp `graph.facebook.com/v21.0/<phoneId>`, Cloudflare `user/tokens/verify` and zone lookup) moves unchanged into each `test()` |
| `/admin/settings/integrations/:id` (GET, PUT, POST …/test) | stay as aliases of the generic routes (§11) for one release | the Admin → Settings screens keep working |
| `AdminIntegrations.jsx` + `shared/src/data/integrations.js` | the real Integration Center (§10); the sample state (`seedIntegrations`, `stepsOf`) is deleted; `INTEGRATIONS` (cards), `emailDnsRecords`, `AI_PROVIDERS` move to the server specs | the "Setup center" route keeps its URL |
| the `channels` link (`/admin/channels`, OTA) | OTA integrations (business scope) in the same list; the existing iCal calendar sync keeps running as the `ota.*` adapters' `iCal` mode | not touched in Phase 1 beyond listing |
| `lib/ai.ts` + AI/Meta live setup (`LiveSetup.jsx`) | `ai.*` and `meta` integrations | **I did not see these files.** The Backend specialist asks the Lead for them before P1-BE-8 touches AI and Meta; they can wait for a later task without blocking the rest |
| `SUPER_ONLY` fields and "Only the super admin can change connection keys." | permissions `platform.integration.manage` (+ `platform.settings.security` for the rest) | same people can do the same things |

### 9.1 Data migration (`integrations:migrate`, idempotent, safe to re-run)

For each existing row, create a **platform** connection and **copy the sealed strings as they are**:

| Existing row | Result |
|---|---|
| `AppSetting "payments"` → `esewa` / `khalti` / `fonepay` with `enabled` and a sealed key | connection with `config` = non-secret fields (`productCode`, `merchantCode`), secret set for the stored `mode` holding the existing sealed `secretKey`. State: stored `mode = "live"` and enabled → `live`, mode live. Stored `mode = "test"` and enabled → `details_entered`, mode test (still usable outside production, §2.2). Not enabled or no key → no row |
| `integration.google`, `.whatsapp`, `.cloudflare` with at least one value | connection; **state `live`** (they are in use today: for example the website adds the Analytics tag as soon as the id is saved); `lastTest` becomes a test-log row; secret fields copied |
| `lastTest.ok = false` | state stays `live` but health `degraded` with the old message, so nothing that works today stops |

The script prints a report (rows migrated, skipped, why). It does not delete the old rows. Both old and new are read during one release (the old `gateways()` falls back
to the old row if no connection exists); the old rows are deleted by a later task that says so.

---

## 10. Screens

One component, used in two places: `IntegrationCenter` (list) and `IntegrationDetail`.

**Admin → Integration Center** (replaces Setup center; the cards grid with "Setup complete / In review / Not set up" counts stays):

- Tabs: **Platform** (Sheetal's own) · **Business requests** (connections in `in_review`, newest first, with the documents viewer and Approve / Reject).
- Filter by group (payments, messaging, AI, social, delivery, channels, tax, web). Each card: icon, name, state badge, health dot, "3 of 5 steps".
- Detail: the steps panel; **Details** (a `FormBuilder` drawn from `describe()`, with Test / Live tabs for secret fields and "Saved" chips instead of values);
  **Documents** (upload, status per document); **Test** button and the last 10 log rows (expandable `checks`); **Go live / Pause / Resume / Apply staged**;
  **Help** side panel (§7); health message and last checked time.
- Buttons follow the permission: viewers (`platform.integration.read`) see state, health and log but no buttons and no values.

**Business → Settings → Integrations** (Phase 2, same components with `scope="business"`): only integrations offered to the business, its own connections,
a "Request integrated payments" flow for payment providers (upload documents → in review → approved → enter details → test → live), and the static-QR option which has no review and
no test (it is a payment method, not an integration; it appears in the same list with the state "On").

States as badges reuse `STATUS_TONE`: neutral (not set up), progress (in review, testing, paused), done (live), and the existing red tone for rejected / failed / down.

---

## 11. Routes

Same handlers for both scopes; the scope decides the permission and the `tenantId`.

| Method + path (admin, platform scope) | Business twin under `/v1/integrations` | Does | Permission |
|---|---|---|---|
| `GET /admin/integrations` | `GET /v1/integrations` | list specs with state, health, step counts | `platform.integration.read` · `workspace.integration.read` |
| `GET /admin/integrations/:id` | same | spec + connection view (no secrets) | same |
| `PUT /admin/integrations/:id` | same | save fields (and staged if live); body names the mode for secret fields | `platform.integration.manage` · `workspace.integration.manage` |
| `POST …/:id/documents` · `DELETE …/documents/:key` | same | upload / remove a document | manage |
| `POST …/:id/submit` | same | submit for review | manage |
| `POST …/:id/test` | same | run `test()`; add `?staged=1` to test the staged set | manage |
| `POST …/:id/go-live` · `/pause` · `/resume` · `/apply` · `DELETE …/:id` | same | transitions | manage |
| `GET …/:id/log` | same | last 50 test-log rows | read |
| `GET …/:id/guide?lang=en` | same | the published help guide | read |
| `GET /admin/integrations/requests` · `POST …/requests/:connectionId/documents/:key` · `POST …/requests/:connectionId/approve|reject` | – | staff queue and decisions | `platform.integration.review` |
| `POST /webhooks/:integrationId/:connectionId` (website API) | – | provider callbacks; verified with the provider's signature or the stored verify token before anything is read | public, verified |

New permissions (added to the manifests, ACCESS.md §6): `workspace.integration.read`, `workspace.integration.manage` (owners only by default; the
hotel "manager" template excludes it), `platform.integration.read`, `platform.integration.manage`, `platform.integration.review` (operations, finance, super admin).

New events (declared in the `workspace` manifest): `workspace.integration.state_changed`, `workspace.integration.health_changed`.

---

## 12. Health and the test log

- **Test log:** every `test`, `live probe`, `go live` and health result is a row (`checks` JSON, `ok`, duration). Shown on the detail screen.
- **Health job** `integrations.health` (platform/jobs), every 15 minutes: for each `live` connection, call `health()` (a cheap read: Khalti lookup of a dummy id, WhatsApp
  phone-number read, Cloudflare token verify, Maps geocode of one word). Providers are called one at a time with a small gap; at most one probe per connection per interval.
- **Rules:** 3 failures in a row → `down`, one notification to the people who manage it (owner, or `notifyStaff("platform.integration.manage")` for platform
  connections), logged once per incident (`healthAlertedAt`). The first success after `down` → `healthy` and a "back to normal" notification. `degraded` = slow or partial.
  Payments that are `down` are hidden from checkout (§2.2) and the screen says why; nothing is paused automatically.
- Webhook channels (WhatsApp, Meta) also record `lastInboundAt`; "live but silent for 7 days" shows as `degraded` with a hint.

---

## 13. Every integration: scope and who sets it up

"Fields" are names only; the exact field lists, patterns and documents are written into each adapter (and edited later in the admin field builder). Where I do not know a
provider's API I say so: the adapter is built when the provider's pack arrives, but the **spec, screens, states and guide already exist**, so credentials arriving later
need no code change (TEAM-RULES).

| # | Id | What | Scope | Set up by | Fields (secret in bold) | Test | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `esewa` | eSewa ePay v2 | platform **and** business | super admin · owner (after document check) | `productCode`, **`secretKey`** (test, live) | sign a request and ask the status API for a made-up transaction: a signed "not found" proves the code and key | `lib/payments.ts` exists; public test merchant outside production |
| 2 | `khalti` | Khalti KPG-2 | platform and business | same | **`secretKey`** (test, live) | lookup of a made-up `pidx`: 401 = bad key, "not found" = key good | exists |
| 3 | `fonepay` | Fonepay web pay | platform and business | same | `merchantCode`, **`secretKey`** | verification call with a made-up PRN and a valid signature | exists |
| 4 | `fonepay_qr` | Fonepay **dynamic QR** | platform and business | same | merchant code, **secret**, QR API user/password (to be fixed from Fonepay's QR spec) | provider's QR-create sandbox call | to build |
| 5 | `card` | Bank card gateway | platform and business | same | provider choice + provider fields | provider sandbox | **bank not chosen yet**; adapter per bank |
| – | static QR | free QR + bank details | business only | owner | QR image, account name, bank, account number | none (no network) | **a payment method, not an integration**; no review; shown "On" in the list |
| 6 | `sms` | SMS (Sparrow) | platform | super admin | provider, **token**, sender | send-credit read | "not used for now"; WhatsApp sends instead; card shows "Not used" as today |
| 7 | `whatsapp` | WhatsApp Cloud API | platform; business when the platform allows own numbers | super admin · owner | `wabaId`, `phoneId`, **`token`**, **`appSecret`**, webhook verify token, templates | read the phone number (the call `admin/.../platform.ts` makes today) | requires `meta` app for the platform one; display-name review and templates are `wait` steps; `fallback: platform` |
| 8 | `email` | Own mail on Cloudflare Email Routing + the mail server | platform | super admin | account id, **API token**, domain, worker secret, outbound method / SMTP | DNS records live, worker answers, test message | requires `cloudflare`; business email *domains* stay in the Mail app (they are DNS work, not credentials) |
| 9 | `cloudflare` | DNS, zone, Turnstile | platform | super admin | `zoneId`, **`apiToken`**, Turnstile site key / **secret** | token verify + zone lookup (as today) | exists |
| 10 | `google` | Analytics, Search Console, Maps, Sign in with Google, Business Profile | platform | super admin | `measurementId`, `searchConsoleToken`, **`mapsKey`**, OAuth client id / **secret**, profile id | Maps geocode (as today); others "saved" checks | exists (three fields) |
| 11 | `ai.anthropic` | Claude | platform (Sheetal AI) **and** business (own key) | super admin · owner | **`apiKey`**, `model`, monthly credit cap | a one-token completion | `AI_PROVIDERS` today; entitlement `ai()` decides which scope an app uses |
| 12 | `ai.openai`, `ai.gemini` | OpenAI, Google Gemini | platform and business | same | **`apiKey`**, `model` | a one-token completion | "ChatGPT Plus does not include API use" note stays in the guide |
| 13 | `voice.elevenlabs` | AI voice and speech-to-text | platform and business | same | **`apiKey`**, `voiceId`, STT provider | voices list | voice call server stays an infrastructure item |
| 14 | `meta` | Facebook and Instagram (Messenger, IG messages, Login, Pages) | platform (the Meta app) **and** business (its own Page) | super admin · owner | app id, **app secret**, verify token, page id, **page token** | app token check, page read | Meta app review is a `wait` step; business connects with Facebook Login |
| 15 | `delivery.pathao` | Pathao | business | owner | provider keys per its merchant API | sandbox quote | adapter when the API pack arrives |
| 16 | `delivery.foodmandu` | Foodmandu | business | owner | same | sandbox | same |
| 17 | `delivery.yango` | Yango | business | owner | same | sandbox | same |
| 18 | `ota.booking`, `ota.airbnb`, `ota.agoda`, `ota.expedia` | Booking.com, Airbnb, Agoda, Expedia | business (iCal links today); platform partner credentials later for API mode | owner · super admin | iCal import URL, export token; later partner id / **secret**, property id | fetch the iCal file and parse it | the current 2-hourly iCal sync keeps running; the `channels` admin screen is listed here |
| 19 | `tax.cbms` | IRD CBMS (tax invoices) | business (platform software registration noted) | owner | PAN, CBMS user, **password** / token | CBMS test endpoint | fields from IRD's technical document; documents §8 |

Not in the Integration Center: object storage (`S3_*` in `.env`, infrastructure), the database, the mail server's own TLS/DNS (docs/mail-server.md).

---

## 14. Build order and open choices

Tasks (also in the handover): **P1-DB-4** tables and the migration script · **P1-BE-8** framework (interface, registry, state machine, secrets with vault v2, log, health job,
routes, alias routes), adapters for eSewa, Khalti, Fonepay, Google, WhatsApp, Cloudflare, and spec-only shells for the rest · **P1-FE-5** the screens.
Provider adapters for #4, #5, #8, #11–#19 are separate later tasks, one per provider.
These do not block the Phase 1 goal (Expenses and Reviews on the kernel); they can slide into Phase 2.

| Choice | Recommendation | Alternative |
|---|---|---|
| Sealing | one sealed value per secret field (copy existing without opening them) | one sealed JSON blob per set: fewer values, but the migration must decrypt and re-encrypt |
| Editing a live connection | staged copy, test, then Apply | edit in place and re-test: a typo takes payments down |
| What "down" does | hides the provider from checkout, notifies, never changes state | auto-pause: surprising, hard to undo |
| Guides | own `HelpGuide` table with repo defaults | CMS pages |
| Business payment fall-back | none | fall back to Sheetal's merchant: a legal and accounting problem |
| Vault binding (v2) | add it now (small change) | leave `v1`: simpler, weaker against copy-between-rows |
