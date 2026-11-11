# Front-end kit: `packages/ui`, `packages/sdk`, `packages/config`

Status: design for Phase 1 (task P1-ARCH-1). Nothing here is built yet. The Frontend specialist builds from this file.
Companions: [KERNEL.md](KERNEL.md) (API shapes), [ACCESS.md](ACCESS.md) (permissions in the screens),
[SETTINGS.md](SETTINGS.md) (the field builder uses the same field format as `FormBuilder`).

What I read: `shared/src/components/Crud.jsx`, `shared/src/core/ui.jsx` (exports list, `Table`, `Tabs`, `Field`, `Drawer`, `Confirm`, `Modal`),
`shared/src/core/{theme,palette,contrast,rbac}.js`, `business/frontend/src/{api,live}.js`, `LiveExpenses.jsx`, `LiveReviews.jsx`.
Not given: `theme.css`, `platform.css`, `Shell.jsx`, `BusinessApp.jsx`, the i18n files. Where I need them I say so.

---

## 1. The problem in numbers

- Every list page is written twice: a **Sample** screen on `localStorage` demo data (`shared/src/demo`) and a **Live** screen on the API
  (`LiveExpenses.jsx` is 278 lines, `LiveReviews.jsx` 81), chosen by `isLive(tenant.id)`.
- Inside a Live page, the same pieces are rewritten by hand: a `useLoad` hook that reloads on branch change, a drawer form with its own
  validation, a branch drop-down when "All branches" is picked, a CSV download, a delete confirmation, toasts.

After this: **one page per screen**, written once from a small description of the resource. It always talks to the API.

---

## 2. What goes where

```
packages/ui/src/
  index.js                  re-exports everything below
  primitives.jsx            Button, Badge, Panel, PageHead, Stat, Tabs, Seg, Field, Input, Textarea, Select, Toggle, Checkbox, Modal, Confirm, Empty, Avatar, Menu, Toast…  (today's shared/src/core/ui.jsx, unchanged API)
  crud/
    CrudPage.jsx            the list page
    DataTable.jsx           the table (+ cards on phones)
    FormBuilder.jsx         the form
    Drawer.jsx              the side panel (today's Drawer, extended)
    ViewDrawer.jsx  DeleteConfirm.jsx  useUndo.js   (today's Crud.jsx, unchanged API)
    ReplyBox.jsx  exportCsv.js  MonthSelect.jsx   small shared pieces taken from LiveExpenses/LiveReviews
  theme/
    mode.js                 light / dark / red / bars (today's theme.js)
    tokens.js               applyTheme(tokens), useTheme(), fontFaceCss()
    ThemeEditor.jsx         the colour/font/radius/logo editor (platform and business)
packages/sdk/src/
  client.js                 createApi(), bizApi, adminApi, ApiError, setActiveTenant, setActiveBranch, fileToBase64, formatBytes (today's api.js)
  hooks.js                  useApiList, useApiGet, useApiMutation
packages/config/src/
  permissions.generated.js  generated from the manifests (ACCESS.md §4.3)
  color.js                  luminance, contrast, mix, shade, darkEnough, textOn, inkFor, btnInkFor, checkTheme  (pure, no DOM; also used by the server)
```

Compatibility: `shared/src/core/ui.jsx`, `shared/src/components/Crud.jsx`, `shared/src/core/theme.js`, `shared/src/core/rbac.js`,
`business/frontend/src/api.js` stay as one-line re-exports (FOLDERS-AND-MOVE-PLAN.md §5), so no screen import breaks.

---

## 3. `packages/sdk`: the API client and hooks

### 3.1 Client

Same behaviour as `bizApi` today, made a factory so the admin panel shares it:

```js
export function createApi({ baseUrl, tokenKey = "sheetal_token", tenantHeader = true }) { /* returns { api, setActiveTenant, setActiveBranch, ready, signedIn } */ }
export const { api: bizApi, setActiveTenant, setActiveBranch } = createApi({ baseUrl: import.meta.env.VITE_BUSINESS_API_URL });
// bizApi(method, path, body?) → Promise<{ data, meta?, message? }> | Blob          (unchanged)
export class ApiError extends Error { status; errors /* { field: string[] } */; code /* NEW: "version_conflict", "app_not_available", … */; requestId /* NEW */ }
```

Headers stay: `Authorization: Bearer`, `x-tenant-id`, `x-branch`. New: when the server answers `409 version_conflict`, `ApiError.code`
is set so screens can say "Someone else changed this. Reload." with a button.

### 3.2 Hooks (no new npm package)

```js
/** A list that reloads when the open business, the picked branch, the params or `refresh()` change. Replaces LiveExpenses' useLoad. */
export function useApiList(path, params = {}, opts = {}):
  { rows: T[] | null, meta: object | null, error: ApiError | null, loading: boolean, refresh(): void }

export function useApiGet(path, opts):  { data, error, loading, refresh }

/** Runs a write, toasts the server's message, refreshes the lists registered under `invalidate`, returns the response. */
export function useApiMutation(method, pathOrFn, opts?: { invalidate?: string[], successToast?: boolean }):
  { run(body?, pathArg?): Promise<Response>, busy: boolean, error: ApiError | null }
```

The branch is read from the same place `useBranch()` reads today (`@sheetal/shared/core/branch`; not given, the hook uses it as is).
A stale response never overwrites a newer one (the `gone` flag pattern in `useLoad`).

---

## 4. `DataTable`

Today's `Table` (`columns`, `rows`, `onRowClick`, `empty`, `rowKey`, `minWidth`) keeps working; `DataTable` is the same plus the
things every list needs.

```js
<DataTable
  columns={[{ key, label, width?, align?, num?, render?(row), sortable?, hideBelow?: 640 | 900 }]}   // key/label/width/align/num/render exist today
  rows={rows}                          // array, or null while loading
  rowKey="id"                          // default "id"
  loading={false}  error={null}        // skeleton rows while loading; an error panel with Retry
  empty={<Empty ... />}
  onRowClick={(row) => ...}            // row opens the ViewDrawer; Enter key works (as today)
  sort={{ field: "spentOn", dir: "desc" }}  onSort={(field, dir) => ...}      // server-side sort: header buttons, aria-sort
  page={{ page: 1, per: 50, total: 312 }}   onPage={(page, per) => ...}       // server-side paging; hidden when total ≤ per
  selection={{ ids, onChange }}        // optional checkboxes + a bulk-action bar slot
  mobile="cards"                       // under 640 px each row becomes a card: first `primary` column as the title
  primary="no"  secondary={["category", "amount"]}
  minWidth={720}
  rowClassName={(row) => row.status === "draft" ? "pf-row-draft" : ""}
/>
```

Rules: money columns use `num` (tabular figures) and `rs()` from `shared/core/format`; dates use `fdate()`; nothing renders raw HTML;
all header buttons are real `<button>`s; the table scrolls inside `.pf-table-wrap` as today. Phones matter: most Nepal
users are on mobile, so `mobile="cards"` is on by default for `CrudPage`.

---

## 5. `Drawer`

Today: `Drawer({ open, onClose, title, sub, children, footer })`, closes on Esc and scrim click, `role="dialog" aria-modal`. Kept. Added:

```js
<Drawer open onClose title sub footer
  size="md"                 // "sm" 360 | "md" 560 (default: the .pf-drawer width in platform.css) | "lg" 640; set by the classes pf-drawer-sm / pf-drawer-lg
  dirty={false}             // when true, Esc / scrim / close ask "Discard your changes?" (Confirm) first
  busy={false}              // blocks closing while a save is running
  initialFocus="first-field"// focus moves into the drawer; returns to the opener on close
/>
```

A focus trap is added (Tab stays inside while it is open). This is a behaviour improvement, not a visual change.

---

## 6. `FormBuilder`

Renders a form from a list of **field definitions**. The same definition format is what the admin **field builder** stores as data
(SETTINGS.md §5), so a field can come from code (Expenses) or from the database (a required document for a payment request) and look the same.

```js
<FormBuilder
  fields={fields}                       // see below
  values={values}  onChange={(patch) => ...}
  errors={errors}                       // { field: string[] } straight from ApiError.errors (422); also shown as a summary at the top
  mode="edit"                           // "edit" | "view" (read-only facts list)
  context={{ categories, branches }}    // data the options/visibility rules may refer to
  disabled={busy}
/>
```

A field definition:

```js
{
  key: "amount",                              // the key in values and in the request body
  type: "money",                              // see the table
  label: "Amount (Rs.)",                      // string, or { en, ne }
  hint: "…",  placeholder: "…",
  required: true,                             // or false → shows "(optional)" like Field does today
  requiredWhen: { key: "category", eq: "other" },
  visibleWhen:  { key: "mode", in: ["create"] },      // simple rules only: eq, in, notEmpty
  readOnlyWhen: { … },
  min, max, maxLength,
  options: [{ id, label }] | { from: "categories" },  // from context
  accept: "image/jpeg,image/png,application/pdf", maxMB: 8,     // for "file"
  columns: 1 | 2,                                      // pair two small fields in a row (the pf-grid-2 tight layout)
}
```

| `type` | Control | Value in `values` | Notes |
|---|---|---|---|
| `text`, `textarea` | Input / Textarea | string | `maxLength` shows a counter past 80% |
| `int` | numeric input | string of digits → sent as number | strips non-digits like `LiveExpenses` does |
| `money` | numeric input + "Rs." | whole rupees string | Phase 1 stays whole rupees (KERNEL.md §4); paisa later with `decimals: 2` |
| `date`, `month` | `<input type="date">` / month select | `YYYY-MM-DD` / `YYYY-MM` | Nepali (BS) display is a later option (`shared/core/bs.js` exists) |
| `select`, `seg` | Select / Seg | id | options from `options` or `context` |
| `toggle` | Toggle | boolean | |
| `branch` | branch drop-down | id | **appears only when "All branches" is picked and the business has several open branches** (what `useBranchChoices` does today); otherwise the server picks |
| `file` | file input + Remove | `File` or existing marker | saved **after** the record (second request), see CrudPage; size and type checked before upload |
| `phone`, `email`, `url` | Input with the right `inputMode` | string | the same regexes the server uses |

Client checks are only for speed (required, length, digits). **The server is the judge**: its 422 field errors are shown under
each field. FormBuilder never decides what is allowed to be saved.

Accessibility: every control has a `<label for>`; errors use `aria-describedby`; the first invalid field gets focus after a failed save.

---

## 7. `CrudPage`

A page for "a list of one kind of record, with add / view / edit / delete and some actions".

```js
<CrudPage
  resource={expenseResource}           // see below
  title="Expenses"  sub="What your business spent, and what is left of what it received."
  tenant={tenant}                      // as pages get it today
  stats={(meta, rows) => [...]}        // optional Stat cards from the server's meta
  banner={(meta) => ...}               // optional strip above the table (e.g. "3 recurring expenses to confirm")
  layout="table"                       // "table" | "cards"
  renderCard={(row, actions) => ...}   // for layout "cards"
/>
```

The resource description (data, no logic except small render functions):

```js
{
  id: "expense",
  label: { one: "expense", many: "expenses" },
  path: "/expenses",                               // GET list, POST create, PUT /:id, DELETE /:id (the routes that exist today)
  perms: { read: "expenses.expense.read", create: "expenses.expense.create", update: "expenses.expense.update", delete: "expenses.expense.delete" },
  list: {
    params: (state) => ({ status: state.status, month: state.month, category: state.category }),
    filters: [ { id: "status", type: "chips", options: [...] }, { id: "month", type: "month", months: 12 }, { id: "category", type: "select", options: { from: "categories" } } ],
    columns: [...],                                // DataTable columns
    defaultSort: { field: "spentOn", dir: "desc" },
    paged: false,                                  // Phase 1: the endpoint returns up to 2000 rows (KERNEL.md §10.5 item 5); true for new apps
    csv: { name: "expenses", head: [...], row: (r) => [...] },
  },
  form: { fields: [...], toForm: (row) => values, toBody: (values) => body, create: { defaults }, edit: { omit: ["branchId"] } },
  view: { facts: (row) => [["Category", ...], ...] },                      // ViewDrawer content
  modes: { confirm: { title: "Confirm expense", submitLabel: "Confirm", when: (row) => row.status === "draft", submit: (row, body, api) => api("POST", `/expenses/${row.id}/confirm`, body), note: "Made by a recurring expense…" } },
  rowActions: [ { id: "skip", label: "Skip", icon: "x", perm: "expenses.expense.delete", when: (r) => r.status === "draft", confirm: "Skip this draft?" } ],
  remove: { label: (row) => row.no, undo: false },                          // DeleteConfirm; undo only if the API can restore (soft delete restore route)
  empty: { icon: "receipt", title: "No expenses yet", sub: "…" },
  afterSave: { file: { field: "receipt", upload: (id, file) => ... } },     // the receipt upload after the main save
}
```

What `CrudPage` does so the page does not:

1. Reads the permissions from `can(role, perm)` (the generated `rbac`): buttons the person cannot use are **not shown**; the server checks again.
2. Loads with `useApiList`, reloads on branch change, shows loading / error / empty states.
3. Opens the `ViewDrawer` on row click; **Edit** and **Delete** appear only with `update` / `delete`.
4. Runs the form in a `Drawer` with `FormBuilder`; maps 422 errors to fields; toasts the server message.
5. Handles `branch` field visibility, `file` upload after save, CSV export (`exportCsv` keeps the formula-injection guard from `LiveExpenses`).
6. On `409 version_conflict` shows "Someone else changed this. Reload." with a Reload button.
7. Never keeps business data in the browser store. (The old sample screens did; that is what we remove.)

### 7.1 Expenses rebuilt

`apps/expenses/frontend/pages/ExpensesPage.jsx`: three tabs. The first two are `CrudPage`; Profit is custom because it is a report.

```jsx
export function ExpensesPage({ tenant }) {
  const [tab, setTab] = useState("expenses");
  const [list, reload] = useApiList("/expenses");          // for the draft count and the permissions flag, as LiveExpenses does
  return (
    <>
      <PageHead title="Expenses" sub="…" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "expenses", label: "Expenses", icon: "receipt", count: list.meta?.drafts || undefined },
                                                 { id: "recurring", label: "Recurring", icon: "clock" }, { id: "profit", label: "Profit", icon: "wallet" }]} />
      {tab === "expenses"  && <CrudPage resource={expenseResource}   tenant={tenant} onChanged={reload} />}
      {tab === "recurring" && <CrudPage resource={recurringResource} tenant={tenant} extraRowActions={recurringStateActions} />}
      {tab === "profit"    && <ProfitTab tenant={tenant} />}      // DataTable + Stat cards + exportCsv; ~60 lines, unchanged logic
    </>
  );
}
```

Size: `LiveExpenses.jsx` is 278 lines; the new page is the three resource descriptions (~40 lines each), this component, and `ProfitTab`.
Behaviour that must stay the same: the "Other needs a note" rule (server message), the draft banner, the 8 MB receipt limit, receipt replace/remove,
the recurring pause/resume/stop buttons, the profit CSV with the same columns and file name pattern, the branch drop-down only with "All branches".

### 7.2 Reviews rebuilt

`apps/reviews/frontend/pages/ReviewsPage.jsx`: `CrudPage` with `layout="cards"`, read-only (no create/update/delete perms in `resource.perms`),
`stats` from `meta` (average, count, waiting), a chips filter (`all`, `unanswered`, `low`), and `renderCard` using the `ReplyBox` component
(textarea, Post / Save reply / Cancel / Remove, calls `POST /reviews/:id/reply`). The `Stars` component moves to `packages/ui` because the
website shows stars too. Texts and the empty states are copied from `LiveReviews.jsx` word for word.

---

## 8. Replacing the Sample / Live pairs with a demo business

### 8.1 What exists

`isLive(tenant.id)` decides per business: live businesses call the API; others use the sample workspace seeded from `shared/src/demo`
and kept in `localStorage` through `useStore()`. Not signed in = sample. Pages marked "Preview" are sample screens still waiting for an API.

### 8.2 Target

1. **A page is written once** and talks to the API. A screen is "migrated" when it no longer reads `db.*` from the store for business
   data. Migrated screens are removed from the `PREVIEW` list in `BusinessApp.jsx` (not given).
2. **Visitors get a real, throw-away business.** "Try the demo" calls `POST /v1/demo/session { type }`:
   - creates a business from the same `createWorkspace()` with `demo = true`, its roles and a head-office branch, then fills it with sample rows
     (`seedDemoData(tx, tenantId, type)` per business type: a few listings, bookings, expenses, reviews…);
   - signs the visitor in as a demo user who is its owner;
   - protects itself: 5 sessions per hour per IP, the robot check (Turnstile, already planned in Setup), 24-hour life, a daily job `demo.cleanup` deletes
     expired demo businesses and users;
   - cuts outside effects: `ctx.business.demo` makes the mailer, WhatsApp, payments and integrations no-ops that return "Demo only" (in the kernel,
     `ctx.entitlements` and the integration layer check the flag).
   Recommendation: one sandbox per visitor, so what one person adds is not seen by the next. Alternative: one shared read-only demo business: much cheaper,
   but people cannot try adding an expense, which is the point of a demo.
3. **The sample data in `shared/src/demo` is retired page by page.** Phase 1 retires Expenses and Reviews only. Deleting `shared/src/demo` and
   the `localStorage` business store is Phase 2's last step, once the last page is migrated.
4. UI state (theme mode, sidebar, picked branch) may stay in `localStorage`; business **data** may not.

Needs (DB specialist, in task P1-DB-1 or a follow-up): `Tenant.demo Boolean @default(false)`, `Tenant.demoExpiresAt DateTime?`.

---

## 9. White-label theming

### 9.1 What exists

- `theme.js`: four **modes** (light, dark, red, bars) stored per app in `localStorage`, applied as `<html data-theme>`.
- `palette.js`: three **colour roles** (brand, dark, light) taken from a logo; `brandTheme(colors)` derives the whole workspace palette; `useBrand(colors)` in
  `live.js` writes it to CSS variables (`--brand-accent`, `--brand-accent-text`, `--brand-accent-ink`, `--brand-accent-soft`, `--brand-light-bar`, `--brand-dark-bar`,
  `--brand-deep`, `--brand-base`, `--brand`, `--brand-dark-page`, `--brand-mist`, `--brand-light-text`, `--brand-light-line`) and adds `html.has-brand`.
- `contrast.js` / `palette.js`: WCAG maths (`luminance`, `contrast`, `darkEnough`, `textOn`, `inkFor`, `btnInkFor`).
- The business saves `logoUrl` and `brandColors` (up to 3) on `PUT /workspace/branding`, only on a paid plan (`plan.price > 0`); a free plan keeps Sheetal's look.
- Sheetal's own crimson `#9D1D21` is the fallback in `fillRoles`.

### 9.2 The token set

A **theme** is a small JSON document. The same shape is used for Sheetal (platform) and for each paying business.

```ts
interface ThemeTokens {
  v: 1;
  colors: {
    brand: Hex; dark: Hex; light: Hex;                     // the three roles that exist today (from the logo, or picked)
    // Optional "advanced" colours. Missing = derived from the three above by brandTheme().
    button?: Hex;                                          // buttons and selected items   (--brand-button)
    text?: Hex;                                            // body text                    (--brand-text)
    page?: Hex;                                            // page background              (--brand-page)
    surface?: Hex;                                         // cards, forms, tables         (--brand-surface)
    field?: Hex; fieldBorder?: Hex;                        // inputs                       (--brand-field, --brand-field-border)
  };
  fonts: { heading: string | null; body: string | null; nepali: string | null };   // font family ids from the font library (§9.5); null = Sheetal default
  radius: number;                                          // base corner radius in px, 0 to 20 (presets: sharp 2, soft 8, round 16)
  logo: { light: string | null; dark: string | null; favicon: string | null };     // file addresses
}
type Hex = `#${string}`;                                   // ^#[0-9a-fA-F]{6}$ (the regex the branding route uses)
```

CSS variables written to `:root` (the existing names stay, so every current style keeps working; new ones are added):

| Group | Variables |
|---|---|
| existing | `--brand-accent --brand-accent-text --brand-accent-ink --brand-accent-soft --brand-light-bar --brand-dark-bar --brand-deep --brand-base --brand --brand-dark-page --brand-mist --brand-light-text --brand-light-line` |
| new colours | `--brand-button --brand-button-text --brand-text --brand-page --brand-surface --brand-field --brand-field-border` |
| fonts | `--font-heading --font-body --font-ne` (a full stack: `"f_ab12", var(--font-ne), system-ui, sans-serif`) |
| shape | `--radius-sm` (base × 0.5) `--radius-md` (base) `--radius-lg` (base × 1.5) |

The Frontend specialist maps the new variables onto the CSS in `theme.css` / `platform.css` (not given to me): the rule is that
**every colour, font family and radius used by a component comes from one of these variables**, with the Sheetal value as the
fallback (`var(--brand-button, var(--accent))`). The default radius equals today's.

### 9.3 Layers and who sets what

```
1  Built-in defaults                      theme.css (today)
2  Platform tokens                        super admin: Admin → Settings → Branding   (Sheetal's own logo, colours, fonts)
3  Business tokens                        the owner: Settings → Branding            (only with the entitlement  branding.custom)
4  Person's mode                          light / dark / red / bars (theme.js): applied on top; derived from the tokens
```

- **Platform** tokens apply to the website, the admin panel and every business without custom branding. Stored in the settings store as
  `theme.platform` (SETTINGS.md §3).
- **Business** tokens are stored as `theme.business` for that business. The entitlement `branding.custom` is today's rule
  (`plan.price > 0`); in Phase 3 it becomes an edition feature the super admin can attach to any app edition or add-on.
- A free business keeps the platform look and its outward pages carry "Powered by Sheetal" (§9.6).
- The two existing columns (`Tenant.logoUrl`, `Tenant.brandColors`) keep working: with no `theme.business` row, tokens are built from them.
  `PUT /workspace/branding` keeps its body and writes both places; a new `PUT /workspace/theme` takes the full token document.

API (business surface):

| Route | Does |
|---|---|
| `GET /v1/theme` | the resolved tokens for the open business (`platform` overlaid with `business` when entitled), the `@font-face` CSS for the fonts used, and `poweredBy: boolean` |
| `PUT /v1/workspace/theme` | save business tokens; needs `workspace.branding.update`; runs `checkTheme` (§9.4); 402 `plan_feature` without the entitlement |
| `GET /v1/site/theme` | public, for the website and printed outputs: platform tokens only |
| `PUT /admin/settings/theme` | platform tokens; needs `platform.settings.update` |
| `GET/POST /admin/fonts`, `PATCH /admin/fonts/:id` | the font library (§9.5), needs `platform.settings.update` |
| `GET /v1/fonts`, `POST /v1/fonts` | fonts the business may pick; upload an own font (§9.5) |

### 9.4 The contrast guard

`checkTheme(tokens)` lives in `packages/config/src/color.js`, which has **no DOM**, so the browser (live preview) and the server (the
real check) run the same code. The server's answer wins.

It runs for each mode the person can pick (light, dark, red, bars), using the colours that mode will really use.

| Pair | Minimum | What happens |
|---|---|---|
| Button text on button colour | 4.5 : 1 | **Auto.** The text colour is chosen (`textOn`). If neither white nor near-black reaches 4.5, the button shade is nudged (`darkEnough`) and the editor says "We adjusted your button colour to keep the text readable." (Today the accent uses 3 : 1; I recommend 4.5 because button labels are normal-size text. Some brands will look slightly darker.) |
| Link / selected-tab text on the page | 4.5 : 1 | **Auto** (`accentInk`, as today). |
| Body text on page, and on cards / forms | 4.5 : 1 | **Blocked** when the person chose both colours: the save is refused with the ratio and a suggested colour. When derived: auto. |
| Muted text (hints) on page | 4.5 : 1 | Auto-derived and checked; nudged if needed. |
| Input border on input background | 3 : 1 | Auto from the text colour; blocked if the person set both and it is lower. |
| Focus ring on page | 3 : 1 | Auto. |
| Heading colour | 3 : 1 (large text) | Allowed lower than body text. |

Rules: **never** write a colour into CSS that was not validated as `^#[0-9a-fA-F]{6}$`; radius is clamped 0–20; font names are
never written into CSS, only library ids (`f_ab12`). So a business cannot inject CSS.

The editor shows a contrast report (each pair, its ratio, pass/adjusted/blocked) and a live preview of a table, a form and a button
in all four modes before saving.

### 9.5 The hosted font library

Why hosted by us: no request to Google Fonts (privacy and speed in Nepal), and the library can include Devanagari fonts.

Data (DB specialist, task P1-DB-4):

```
FontFamily (id, name, category, scripts ["latin","devanagari"], weights [400,500,600,700], source "library"|"upload",
            tenantId?  (null = Sheetal's library),  files Json [{ weight, style, format, url, bytes }],
            license, licenseConfirmedBy?, status "active"|"hidden", createdBy, createdAt)
```

- **Library** (managed by staff, Admin → Settings → Branding → Fonts): upload `woff2` files, set name, scripts, weights, license note, hide/show.
  Suggested starter set, all open-licence families (the owner confirms the licences before launch): Inter, Poppins, Noto Sans, Noto Sans Devanagari, Mukta,
  Hind, Tiro Devanagari. Each family should have a Latin file and a Devanagari file, so a Nepali page never falls back to a system font.
- **Upload by a business** (needs `workspace.branding.update` and the feature `branding.custom_fonts`): `woff2` only (later `woff`); at most 4 files and 400 KB
  each; the file type is checked by its first bytes (`wOF2`), as photos are; a tick box "I have the right to use this font on the web" is required and stored
  with the user and date. `ttf`/`otf` are refused with "Upload a .woff2 file" (converting needs a package; TEAM-RULES rule 5).
- **Serving:** files go to object storage (`S3_BUCKET`/`MEDIA_URL`) under a random id, with `Cache-Control: public, max-age=31536000, immutable`, and are
  loaded with `font-display: swap` and `unicode-range` splits so a page only downloads the script it shows. The server builds the `@font-face` CSS from the table
  (never from user text) and returns it in `GET /v1/theme`.
- **Fallback stack:** `var(--font-body)`, then `var(--font-ne)`, then the system UI fonts, so a missing or slow font never breaks the layout.
- **Preview in the picker:** each family is shown with "Namaste नमस्ते 1,25,000" so Latin, Devanagari and digits are checked at a glance.

### 9.6 Where branding appears

| Surface | What is applied | Free business |
|---|---|---|
| The business panel (its own team) | all tokens, via CSS variables | Sheetal's look |
| Printed / PDF invoices, receipts, statements | logo, brand colour, body font (embedded) | Sheetal's look + "Powered by Sheetal" in the footer |
| Public business pages and online forms | all tokens (server-rendered `:root{…}` in `<head>` to avoid a flash) | Sheetal's look + "Powered by Sheetal" |
| Emails to the business's customers | logo, brand colour, web-safe font | Sheetal's look + "Powered by Sheetal" |
| The admin panel and the website | platform tokens only | – |

Recommendation: "Powered by Sheetal" is on outward-facing things only, not inside the panel, since the panel is for the business's own staff.
Alternative: also a small footer link in the panel for free plans. The owner decides.

First paint: the panel stores the last resolved tokens in `localStorage` (`sheetal_theme_cache:<tenantId>`) and a small boot script (like the
one in each `index.html` that sets `data-theme`) paints them before the API answers; the API response then replaces them.

### 9.7 `ThemeEditor` (one component, two places)

`<ThemeEditor scope="platform" | "business" value onSave />` in `packages/ui/src/theme/`:
logo upload (uses `cleanLogo` and `extractPalette` from `palette.js`, as the branding screen does now) → three roles filled → optional advanced colours →
font pickers (heading, body, Nepali) → radius presets → contrast report → live preview in four modes → Save. In `business` scope it shows the upgrade
message from the 402 when the plan does not include it. Admin → Settings → Branding uses `scope="platform"`.

---

## 10. Build order for the Frontend specialist

| Task | Delivers |
|---|---|
| P1-FE-1 | `packages/ui` (move + `DataTable`, `Drawer` extras, `FormBuilder`, `CrudPage`), `packages/sdk`, `packages/config/color.js`; shims; unit tests with Vitest for `checkTheme` and `FormBuilder` rules |
| P1-FE-2 | Expenses page on the kit; hand-test script |
| P1-FE-3 | Reviews page on the kit; demo business flow ("Try the demo") |
| P1-FE-4 | Shell menu from manifests, role screen with scopes and the Approvals inbox, Team screen with branch ids |
| P1-FE-5 | Integration Center screens (INTEGRATIONS.md §10) |
| P1-FE-6 | Settings, field builder screens (SETTINGS.md §8) and `ThemeEditor` |

## 11. Tests and checks

- Vitest (root) for pure functions: `checkTheme` (a table of colour pairs), `FormBuilder` rules (`requiredWhen`, `visibleWhen`), CSV cell guard, `useApiList` race.
- A hand-test script per page in CHANGES: role × branch × viewport (phone width) × Nepali font on.
- Lint rule: no `import … from "@sheetal/shared/demo"` inside `apps/**/frontend`.


## 10. Added by P1-FE-2 (Expenses)

- `resource.versioned: true`: CrudPage sends the row's `version` on change (PUT), on a mode such as Confirm, on row actions (body) and on delete (`?version=`). A 409 shows "Someone changed this. Reload to see the latest." and reloads the list. No silent retry. The requests live in `crud/saveFlow.js` (no React, tested).
- `resource.titles { create, edit }`, `addLabel`; `list.columns` may be a function `(rows, meta, context) => columns`; `list.note`; `view.facts(row, context)`, `view.canEdit(row)`.
- `rowActions`: `label` and `confirm` may be functions of the row; `edit: true` opens the form, `remove: true` asks to delete, `refresh: false` skips the reload (opening a receipt), `first: true` puts it before the mode buttons, `danger`, `when(row)`, `perm`, `run(row, api, { version })`.
- `remove { title(row), text, confirmLabel(row) }`; `afterSave.file { field, upload, remove, failText }`; `modes[x] { title, submitLabel, note, when, submit(row, body, api) }`.
- `CrudPage` props: `extraContext` (merged into the context that feeds option lists, e.g. categories).
- Fields: `minLength` (while required), `labelWhen { when, label }`, `options { from, label }` (fixed label key).
- Styles: skeleton, phone cards, pager, bulk bar, drawer widths are classes in platform.css (`pf-skel`, `pf-cards`, `pf-card-*`, `pf-pager`, `pf-bulk`, `pf-money`, `pf-drawer-sm|lg`); under 640 px every button is at least 44 px high.


## 11. Added by P1-FE-3 (Reviews)

- `Stars` is in `packages/ui` (`@sheetal/ui/stars`, also exported from `@sheetal/ui`): `<Stars value size onPick label />`. Read-only it is one image with the label "3.5 out of 5 stars"; with `onPick` it is a radio group of five buttons ("1 star" … "5 stars"). The value is rounded to the nearest whole star. The website keeps its own `Stars` (different icon library and `.stars` CSS, so not a drop-in).
- `CrudPage` in card layout: `renderCard(row, { open, edit, remove, reload, meta, api })` (new: `meta`, `api`); `list.gridClass` names the wrapper class; `resource.empty` may be a function of the filters `(filters) => ({ icon, title, sub })`; `resource.loadingText` replaces "Loading…".
- A read-only resource has no `form` and no `remove`; a write that is not create / change / delete (a reply) is sent with `runRowAction`, so `resource.versioned` puts the version in the body.
- Classes in platform.css: `pf-review-list`, `pf-review`, `pf-review-head`, `pf-review-text`, `pf-review-box`, `pf-review-code`, `pf-star-pick`, `pf-start`.
