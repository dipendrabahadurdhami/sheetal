# Update E: People, Developer keys, AI accounts

**Not run:** there was no repo or database here. Every file was syntax-checked (esbuild) only. Please run `npm run check` and the tests before merging. The tests are written from the routes, not run against them.

## Migration
Name: `people` (one migration for all three: Attendance, LeaveType, LeaveRequest, ApiKey, and `AiUsage.own`).

```powershell
cd backend-core
npx prisma migrate dev --name people
cd ..
npm run people:roles          # once: gives managers of existing businesses people.view / people.manage
npm run check
```
No new env vars. `.env.local`, `LiveBilling.jsx` and `admin/backend/src/app.ts`, `AdminApp.jsx` need no change.

## New files
- `backend-core/scripts/people-roles.ts`
- `business/backend/src/modules/people/routes.ts`: `/v1/people/*`
- `business/backend/src/modules/devkeys/routes.ts`: `/v1/developers/keys`
- `business/backend/src/modules/aiaccount/routes.ts`: `/v1/ai-account`
- `website/backend/src/modules/public/routes.ts`: `/v1/public/listings | leads | bookings`
- `business/frontend/src/pages/LivePeople.jsx`, `LiveDevelopers.jsx`, `LiveAiAccounts.jsx`
- Tests: `business/backend/test/people.test.ts`, `devkeys.test.ts`, `ai-accounts.test.ts`, `website/backend/test/public-api.test.ts`

## Changed files (whole file included)
- `backend-core/src/lib/ai.ts`: `OWN_MODELS`, `TenantAi`, `tenantAiKey`, `aiFor()`; `creditsUsed`/`record`/`aiError` know about own keys; `compareListings` and `extractLeads` take the own-key path.
- `business/backend/src/modules/growth/routes.ts`: `ai(ws)` uses `aiFor`; `/ai/usage` returns `{enabled, own, used, limit}`.
- `website/backend/src/modules/insight/routes.ts`: Ask AI uses `aiFor` (falls back to Sheetal's key when the business's cap is used).
- `business/backend/src/modules/branches/routes.ts`: branch-removal check now counts attendance records and leave requests.
- `business/frontend/src/pages/BusinessPages.jsx`: Attendance tab uses `LivePeople` when live.

## Shared files: exact edits
- **schema.prisma**: in `model Branch`, below `stockItems  StockItem[]` add `attendance    Attendance[]` and `leaveRequests LeaveRequest[]`. In `model AiUsage`, below `credits   Int` add `/// Made with the business's own AI key…` and `own       Boolean  @default(false)`. Append models `Attendance`, `LeaveType`, `LeaveRequest`, `ApiKey` after `StockRecipe` (end of file).
- **permissions.ts** / **rbac.js** (identical edits): in the module list, after the line above it add `{ module: "people", types: "all", perms: ["people.view", "people.manage"] },`. Append `"people.view", "people.manage"` to the `sales_manager` (developer) and `branch_manager` (agency) arrays. Manager templates that are `null` inherit them.
- **business/backend/src/app.ts**: below `import { startStockJob, stockRoutes } …` add the imports for `peopleRoutes`, `devKeyRoutes`, `aiAccountRoutes`. Below `await app.register(stockRoutes, { prefix: "/v1" });` add `peopleRoutes`, `devKeyRoutes`, and `await app.register(aiAccountRoutes, { prefix: "/v1", ai: deps.ai });`.
- **website/backend/src/app.ts**: below `import { siteRoutes } …` add `import { publicApiRoutes } from "./modules/public/routes.js";`. Below `await app.register(siteRoutes, { prefix: "/v1" });` add `await app.register(publicApiRoutes, { prefix: "/v1" });`.
- **BusinessApp.jsx**: `PREVIEW` is now only `"/business/social", "/business/voice"`. Below `import { LiveStock } …` add imports of `LiveDevelopers` and `LiveAiAccounts`. The `/business/developers` and `/business/ai-accounts` routes use the Live page when `isLive(tenant.id)`.
- **package.json** (root), below `"agreements:roles": …`: `"people:roles": "npm run people:roles -w @sheetal/backend-core --",`
- **backend-core/package.json**, below `"agreements:roles": …`: `"people:roles": "tsx scripts/people-roles.ts",`
- **scripts/help.mjs**, below the `agreements:roles` entry: the `people:roles` entry.

## Behaviour to know
- **People:** the late rule uses `Tenant.settings.people.workStart` (default 10:00), set under Month → Settings. Late is marked on the first check-in of the Nepal day. Saturday is the weekly day off (not counted as leave or absent). Leave types (Casual, Sick, Home, Festival, Unpaid) are created on first use. Managers can't approve their own leave. Fixes need a reason and are audited with before/after.
- **Developer keys:** `sk_live_…`, only the sha256 and an 8-character prefix are stored; shown once. 60 calls a minute per key. Scopes `listings.read`, `leads.write`, `bookings.read`. Bookings leave out phone, email and notes. Enquiries arrive in the Inbox as kind `api`. Set `VITE_WEBSITE_API_URL` in business/frontend/.env.local if you want the curl examples to show your real address (optional).
- **AI accounts:** the key is sealed with the Vault and never returned (only `hasKey` and last 4). Own-key usage is marked `own` and doesn't use plan credits. Sheetal can turn own keys off with `integration.ai.allowOwnKeys = false`.

## Assumptions to check
- `unauthorized` error code and the booking status values weren't visible, so the public API uses a plain `AppError(401, "unauthorized")` and a free `status` filter.
- Sample screens `People`, `Developers`, `AiAccounts` are unchanged and still show when not live.
- Icon names `users`, `calendar`, `key`, `copy`, `download`, `sparkles` are used in the new screens; swap if your icon set names them differently.
