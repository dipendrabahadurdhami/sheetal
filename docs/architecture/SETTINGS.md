# Settings, Field Builder, Revenue Share and Revenue Reports

Status: design for Phase 1 (task P1-ARCH-1). Nothing here is built yet.
Companions: [INTEGRATIONS.md](INTEGRATIONS.md) (integration fields and documents use the field format in §5),
[FRONTEND-KIT.md](FRONTEND-KIT.md) (`FormBuilder` draws these fields; theme settings), [APP-MANIFEST.md](APP-MANIFEST.md) (apps declare their settings),
[ACCESS.md](ACCESS.md) (permissions).

Rule from TEAM-RULES: **anything the owner may want to change later is a setting, not code.**

What I read: `domain/platform.ts`, `domain/billing.ts`, the admin `platform.ts` routes, `config.ts`.
Not given: the catalog/pricing code, the `Payment` and `Commission` models, `AppSetting` in `schema.prisma`. The shapes below are what the code I read implies; the DB
specialist confirms the real columns first.

---

## 1. What exists today

`AppSetting` rows: one `key` (string) with a JSON `value`, no type, no scope, no history. Keys seen: `platform`, `billing`, `payments`, `catalog`,
`integration.google`, `integration.whatsapp`, `integration.cloudflare`. Each is read by a hand-written function with its own `zod` schema in
`domain/platform.ts` or `domain/billing.ts`. Writes record an audit row naming the fields changed.

This works for a few keys. It does not give: a list of all settings, typed validation in one place, business-level settings, defaults declared by apps,
a change history, or screens drawn from data.

---

## 2. The typed settings store

Folder: `platform/src/settings/`. The `AppSetting` table **stays** (no data move); a registry wraps it.

### 2.1 Definitions

Every setting is declared once, in code, with a type. Apps declare theirs in their manifest (`settings:` in APP-MANIFEST.md); the platform declares its own.

```ts
export interface SettingDef<T = unknown> {
  key: string;                          // "platform.company", "apps.expenses.requireReceiptAbove", "theme.platform"
  scope: "platform" | "business";       // platform: one value for Sheetal · business: one value per business, falls back to the platform default
  schema: ZodType<T>;                   // the ONLY place a value is validated
  default: T;                           // used when nothing is stored
  label: Text; help?: Text;
  group: string;                        // "company" | "billing" | "theme" | "expenses" …  (where it shows on screens)
  secret?: boolean;                     // sealed with Vault, write-only (integration secrets stay in INTEGRATIONS.md; this is for rare single secrets)
  public?: boolean;                     // may be sent to the website without login (site name, contact phone). Default false.
  read:  Permission;                    // e.g. "platform.settings.read"
  write: Permission;                    // e.g. "platform.settings.billing" · "workspace.settings.update"
  audit?: "names" | "values";           // default "names": the audit row lists changed field names only. "values" only for non-sensitive ones (colors).
  version?: number;                     // schema version for migrate()
  migrate?: (old: unknown, fromVersion: number) => T;
}
```

### 2.2 The API (used by services; never raw `AppSetting` calls)

```ts
interface SettingsService {
  get<T>(def: SettingDef<T>, ctx?: BusinessContext): Promise<T>;          // business value → platform value → def.default; zod-parsed; a bad stored value logs and returns the default, never throws on a read
  set<T>(def: SettingDef<T>, value: T, ctx: Context): Promise<T>;        // validate → check def.write → one transaction: row + audit + outbox event settings.changed
  reset(def, ctx): Promise<void>;                                         // delete the stored row so the default or platform value applies again
  history(def, ctx, limit?): Promise<SettingChange[]>;                    // from the audit log: who, when, which fields
  describe(scope): SettingGroup[];                                        // definitions grouped for the admin screens (no values)
}
```

- **Storage:** platform value → `AppSetting { key }`. Business value → `AppSetting { key: "t:<businessId>:<key>" }` (no new table; the repository-isolation rule still
  holds because only `SettingsService` builds that key from `ctx`, never from a caller's string). If the DB specialist prefers, a `BusinessSetting(tenantId, key, value)` table
  is cleaner; either is hidden behind `SettingsService`.
- **Cache:** per-process, 30 seconds, cleared on `settings.changed`. A change is seen everywhere within 30 seconds, immediately on the server that wrote it.
- **Events:** `settings.changed { key, scope, tenantId?, fields[] }`, so other code reacts (the theme refreshes, the commission calculator reloads).
- **History:** a row in the audit log per write: `settings.<key>` with `{ fields: [...] }` (names only for secrets, as now).

### 2.3 Keys

| Key | Scope | Today | Purpose |
|---|---|---|---|
| `platform.company` | platform | `AppSetting "platform"` (part) | Sheetal's own company profile (legal name, PAN, address, contact, bank for manual payments) |
| `platform.site` | platform | `AppSetting "platform"` (part) | site name, tagline, contact shown publicly (`public: true`) |
| `platform.security` | platform | `AppSetting "platform"` (part) | maintenance mode, sign-up on/off, session length, impersonation limits |
| `platform.billing` | platform | `AppSetting "billing"` | trial days, grace days, VAT rate, invoice prefix, currency |
| `platform.revenueShare` | platform | partly `catalog` | commission and partner split (§6) |
| `platform.catalog` | platform | `AppSetting "catalog"` | editions, prices, free limits: the admin-owned copy of the manifest defaults (APP-MANIFEST.md "editions") |
| `platform.payments` | platform | `AppSetting "payments"` | **moves to the Integration Center** (INTEGRATIONS.md §9); only `manual.enabled` and bank-transfer text stay here |
| `platform.theme` | platform | – | Sheetal's `ThemeTokens` (FRONTEND-KIT.md) |
| `platform.fieldDefs.*` | platform | – | field-builder definitions (§5) |
| `business.profile` | business | – | the business's profile (name, PAN, address, logo, contact), shaped by the field builder (§5.4) |
| `business.theme` | business | `branding.custom` today | the business's `ThemeTokens` override |
| `business.branding` | business | (workspace) | "Powered by Sheetal" visibility, public name |
| `apps.<id>.*` | business, falls back to platform | – | each app's own settings from its manifest (for Expenses: categories list, receipt required above N paisa, approval on/off) |

Integration settings (`integration.google` etc.) are **not** here; they are connections (INTEGRATIONS.md).

### 2.4 Migration of today's rows

`settings:migrate` (idempotent, prints a report). It reads each existing row, runs it through the new schema, and writes it back in the same `AppSetting` row if the shape differs.
`platform` is split into `platform.company` / `.site` / `.security` by field name, using the field lists already in `domain/platform.ts`; the old key is kept for one release as a read fallback.
Unknown fields are kept in the row under `_legacy` and reported, never dropped. Nothing is deleted by this task.

---

## 3. Screens

Admin → Settings keeps its URL and tabs; each tab is now drawn from `describe()` with `FormBuilder` + `SettingsForm` (a `FormBuilder` bound to a `SettingDef`):

| Tab | Keys | Permission to open / change |
|---|---|---|
| Company | `platform.company`, `platform.site` | `platform.settings.read` / `platform.settings.update` |
| Billing and catalog | `platform.billing`, `platform.catalog` | `platform.settings.read` / `platform.settings.billing` |
| Revenue share | `platform.revenueShare` | super admin only (`platform.settings.revenue`) |
| Theme | `platform.theme` (+ font library) | `platform.settings.update` |
| Security | `platform.security` | super admin (`platform.settings.security`) |
| Field builder | `platform.fieldDefs.*` | `platform.settings.fields` (super admin by default) |
| Integrations | → Integration Center | see INTEGRATIONS.md |

Business → Settings (Phase 2): Profile (`business.profile`), Branding (`business.theme`, `business.branding`), one tab per app that has `settings:`. Business permission: `workspace.settings.read` / `.update`.

Every form shows: the current value or "Using the default", a **Reset to default** link, and **History** (last changes: who, when, which fields).

---

## 4. Changing things safely

- A setting write that would break a running thing (shrinking a free limit below what a business already uses; turning off a gateway that has a pending payment) is refused by
  an optional `guard(value, ctx)` on the definition, with a plain message. Limits never lock a business out of data it already has; they stop *new* use.
- Defaults declared in manifests apply only until an admin saves the first value (APP-MANIFEST.md "editions"). After that the stored value wins; a new release never overwrites it.
- Catalog and price changes apply to new subscriptions and to renewals; the invoice already issued is never rewritten.

---

## 5. The field builder

The owner's rule: *"which fields and documents are needed for company profile, business profile, verification and each integration's onboarding, who fills them, whether
they are required, public or private, and the file types."* This is **data edited on a screen**, using one field format that is also what `FormBuilder`
(FRONTEND-KIT.md) draws.

### 5.1 The field format

```ts
export interface FieldDef {
  key: string;                          // "pan", "registration_certificate"; unique inside its form; never changed after use
  type: "text" | "textarea" | "number" | "money" | "date" | "select" | "multiselect" | "checkbox"
      | "phone" | "email" | "url" | "pan" | "address" | "file" | "image";
  label: Text;                          // { en, ne }
  help?: Text;
  placeholder?: Text;
  options?: { value: string; label: Text }[];      // select / multiselect
  validation?: { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string; message?: Text };
  required: boolean;
  filledBy: "business_owner" | "business_staff" | "platform_staff" | "system" | "anyone_with_link";
  visibility: "public" | "private";     // public: may be shown on the business's website/receipts · private: only the business and the staff named in readBy
  readBy?: ("platform_staff" | "business_owner" | "business_staff")[];   // default: filledBy plus platform_staff
  editableAfter?: "always" | "until_verified" | "never";                 // "never": a verified PAN can only change through support
  file?: { types: ("pdf" | "jpg" | "png")[]; maxMB: number; expires?: boolean };   // for type file / image
  group?: string;                       // section on the form
  order: number;
  showIf?: { key: string; equals: string | boolean | number };           // one simple dependency; no scripting
  archivedAt?: string;                  // removed from forms but old answers are kept
}

export interface FormDef { id: string; scope: "platform" | "business"; label: Text; fields: FieldDef[]; version: number }
```

`DocumentDef` in INTEGRATIONS.md §2 is the same thing with `type: "file"`; the integration spec converts to `FieldDef`, so one screen edits both.

### 5.2 Where definitions live

`FormDef` rows are stored as settings: `platform.fieldDefs.<formId>`. A **form id** is one of:

| formId | Scope | Used by | Filled by (typically) |
|---|---|---|---|
| `company_profile` | platform | Sheetal's own profile screen | platform staff |
| `business_profile` | business | the business's profile; sign-up and Settings → Profile | business owner |
| `business_verification` | business | the "Verify your business" flow (PAN, registration, ID, address proof) | business owner; reviewed by platform staff |
| `integration.<id>.<scope>` | per integration | onboarding for each integration (INTEGRATIONS.md); the integration's fields and documents appear here for editing | owner / platform staff |
| `<app>.<form>` | business | an app's own configurable form (optional, e.g. a lead form) | as set |

Seeded from the repo on first start (`platform/src/settings/fieldDefs/*.ts`). **Seeded forms below are examples to be confirmed by the owner**; I do not know the legal requirements for
Nepali business verification.

### 5.3 What the builder lets the super admin do

On Admin → Settings → Field builder: pick a form → add, reorder, edit, archive fields. For each field: label (English / Nepali), help text, type, required, **who fills it**,
**public or private**, who may read it, file types and size, validation, "editable after verification". A **preview** shows the form as the business will see it.

Rules:
- Cannot delete a field that has answers: it is **archived** (hidden on new forms; old answers kept and shown to staff).
- Cannot change `key` or the `type` of a field that has answers (create a new field instead).
- A field a built-in feature **needs** (for example `pan` for tax invoices, `name` for a business) is marked `locked: true` in the seed: it can be relabelled but not removed or made optional.
- Each save increments `FormDef.version`; the answers store the version they were given under.
- Every change is audited with field keys (not values).

### 5.4 Where the answers are stored

The data model has to hold **answers to fields that can change** without a migration each time.

| Answers for | Stored in | Note |
|---|---|---|
| `business_profile` | `business.profile` setting (`{ values: { [fieldKey]: value }, version }`) **plus** the existing `Tenant` columns that code already uses (`name`, `pan`, phone, address…): the field builder maps its locked fields onto them with a `mapsTo` column name, and writes both | existing code keeps reading `Tenant`; new fields live in the JSON |
| `company_profile` | `platform.company` setting | |
| `business_verification` | `BusinessVerification` (task P1-DB-4): `id, tenantId, formVersion, status (draft/submitted/approved/rejected), answers Json, submittedAt, reviewedBy, reviewedAt, note` + `BusinessVerificationFile (verificationId, fieldKey, fileRef, mime, bytes, status, note)` | files go to `platform/files` private storage |
| integration documents | `IntegrationDocument` (INTEGRATIONS.md §5) | |

Visibility is applied at read time by one function `projectFields(form, answers, viewer)`; services never return an answer the viewer may not read. A `public` field is the only kind
the public website API may return.

### 5.5 Verification flow

`business_verification`: draft → submitted → approved / rejected (note required). Approved → the `Tenant.verifiedAt` mark (a column for the DB specialist) and `editableAfter: until_verified` fields lock.
Rejected → the owner edits and re-submits. Events: `workspace.verification.submitted`, `.approved`, `.rejected` (notifications to the owner and to `platform.verification.review` staff).
New permission `platform.verification.review`. Seeds make **verification optional in Phase 1** (a setting `platform.security.verificationRequiredFor` is empty), so nothing existing is blocked.

### 5.6 Seeded examples (all editable on the screen)

`business_profile`: business name (locked, public, owner), type (select, public), PAN (locked, private→verification, `pan` pattern, editable until verified), phone (public), email (public), address (public),
logo (image png/jpg 2 MB, public), website (url, public), about (textarea, public).
`business_verification`: PAN certificate (pdf/jpg/png, 5 MB, required), company registration (pdf/jpg/png, required), owner citizenship front/back (jpg/png, required, private), address proof (pdf/jpg, optional),
signed agreement (pdf, optional).
`company_profile`: legal name, PAN/VAT, registered address, contact phone/email, authorised signatory, bank details for manual transfers (private), logo.

---

## 6. Revenue-share settings

Sheetal earns from subscriptions and from a share of payments made through the platform. I do not have the `Commission` / `Payment` models, so the settings are defined here and the report
(§7) is defined against the fields I expect; the DB specialist maps them.

`platform.revenueShare` (super admin only, with a reason on every change):

```ts
{
  commissionPct: number,                 // platform default share of online payments, % — recommended default 10 (the figure in the earlier handover); 0–100, up to 2 decimals
  perApp?: { [appId: string]: number },  // optional override per app (hotel 10, pos 5 …)
  perGateway?: { [integrationId: string]: number },   // optional override (card gateways may need a different rate)
  technologyPartner: {
    enabled: boolean,
    name?: string,
    sharePct: number,                    // % of Sheetal's share (not of the payment) paid to the technology partner
    appliesTo: "all" | "listed",
    apps?: string[],
  },
  rounding: "nearest_paisa",             // fixed, listed so the rule is visible
  effectiveFrom: string,                 // ISO date, Nepal time; a change never rewrites earlier days
}
```

Rules:
1. Each payment row stores `commissionPct` and `commissionPaisa` **at the time it was made** (the DB specialist adds the two columns if absent). Changing the setting changes
   *later* payments only. Reports sum the stored amounts, never recalculate from today's percentage.
2. Order of precedence: `perGateway` → `perApp` → `commissionPct`.
3. Commission applies to **platform-processed live payments** only: payments through the business's own gateway keys, test-mode payments, manual transfers and refunded parts are not counted.
4. Partner share = `commissionPaisa × technologyPartner.sharePct / 100`, rounded to the nearest paisa; Sheetal net = commission − partner share. Kept as two stored columns, not recalculated.
5. All amounts are `Money` (paisa); the report returns paisa plus a formatted rupee string.
6. History is read from the audit log; `effectiveFrom` makes a future-dated change possible.

---

## 7. Revenue reports

Screen: Admin → Reports → Revenue. Permission `platform.revenue.read` (finance, super admin). One API, one query function, used by all ranges.

### 7.1 Ranges

All day boundaries are **Nepal time (UTC+05:45)**: a day runs 00:00:00 to 23:59:59.999 Nepal time, converted to UTC for the query.

| Range | From | To |
|---|---|---|
| Today | start of today | now |
| Last 7 days | start of the day 6 days ago | now (7 days including today) |
| Last 30 days | start of the day 29 days ago | now |
| Custom | `from` date | `to` date (inclusive); maximum 366 days; `from ≤ to` |

Comparison: each range also returns the **previous period of the same length** and the % change.

### 7.2 Measures

| Measure | Meaning | Source |
|---|---|---|
| `gross` | total live payments processed by the platform | `Payment.amountPaisa`, status paid, `mode = live`, via platform gateway |
| `subscriptionRevenue` | paid subscription invoices | billing invoices, status paid |
| `commissionRevenue` | Sheetal's share of payments | `Payment.commissionPaisa` |
| `partnerShare` | paid to the technology partner | `Payment.partnerSharePaisa` |
| `netToSheetal` | `subscriptionRevenue + commissionRevenue − partnerShare` | computed |
| `refunds` | refunded amounts in the range, subtracted | refund rows |
| `count` | number of payments / paid invoices | |

Breakdowns (all optional via `groupBy`): `day`, `app`, `gateway`, `business`, `plan`. For a range over 31 days `day` falls back to `week`; the caller may ask for `month`.

### 7.3 Query

```ts
// platform/src/settings/revenue.ts  (BE specialist, task P1-BE-9)
interface RevenueQuery { range: "today" | "7d" | "30d" | "custom"; from?: string; to?: string; groupBy?: "day" | "week" | "month" | "app" | "gateway" | "business" | "plan" }
interface RevenueReport { from: string; to: string; totals: Totals; previous: Totals; changePct: Record<keyof Totals, number | null>; rows: { key: string; label: string; totals: Totals }[] }
```

One SQL statement per source, aggregated in the database (`date_trunc` after `AT TIME ZONE 'Asia/Kathmandu'`), never summed in Node. The example for commission by day:

```sql
SELECT date_trunc('day', p."paidAt" AT TIME ZONE 'Asia/Kathmandu') AS day,
       SUM(p."amountPaisa") AS gross, SUM(p."commissionPaisa") AS commission,
       SUM(p."partnerSharePaisa") AS partner, COUNT(*) AS n
FROM "Payment" p
WHERE p."status" = 'paid' AND p."mode" = 'live' AND p."viaPlatform" = true
  AND p."paidAt" >= $1 AND p."paidAt" < $2
GROUP BY 1 ORDER BY 1;
```

(`viaPlatform` and `mode` are my assumed column names; the DB specialist maps them to the real ones.) Indexes: `(status, mode, paidAt)`. Results are cached 60 seconds; "Today" is never cached longer than that.
Export: CSV for any range. Every export is audited (`platform.revenue.export`).

### 7.4 Checks (tests)

- The `Asia/Kathmandu` boundaries: a payment at 23:50 Nepal time is in that day; at 00:10 next day is not. A payment at 18:14 UTC is 23:59 Nepal time.
- Changing `commissionPct` today does not change last week's totals.
- Test-mode and own-gateway payments are excluded.
- Totals equal the sum of the rows. Previous period has the same length.
- A non-finance staff member gets 403.

---

## 8. Build order and open choices

Tasks: **P1-DB-4** (`BusinessVerification` tables, `FontFamily`, payment commission columns if missing, `Tenant.verifiedAt`) · **P1-BE-9** (settings registry, migration, field-builder backend, verification, revenue
queries) · **P1-FE-6** (settings screens, field builder UI, ThemeEditor, revenue report screen). The revenue report can ship after the rest if the payment models arrive late.

| Choice | Recommendation | Alternative |
|---|---|---|
| Business setting storage | `AppSetting` rows keyed `t:<id>:<key>` behind `SettingsService` (no new table) | a `BusinessSetting` table: cleaner, one more migration |
| Business profile answers | JSON in the setting plus the existing `Tenant` columns for locked fields | move all to `Tenant` columns: breaks the "fields can change without a migration" goal |
| Commission rate | 10% default, per-app and per-gateway overrides allowed | a single rate: simpler, less flexible |
| Verification in Phase 1 | built, optional (nobody is forced) | required for payments: confirm the rule with the owner first |
| Report timezone | Nepal time, fixed | per-viewer timezone: not needed, every owner is in Nepal |
