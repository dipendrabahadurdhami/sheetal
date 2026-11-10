# Update F: Channels, AI hub, message templates, expiry reminders

NOT RUN: the zip held only part of the repo and there is no database here, so `npm run check`, the migration and the
tests have not been run. Every new and changed file was syntax-checked (esbuild) and nothing more. Run them and send me
any message they print.

## Before you start (PowerShell, in the repo root)
```
Expand-Archive -Path .\sheetal-channels-ai-hub.zip -DestinationPath . -Force
npm run db:migrate        # when it asks for a name, type: ota
npm run check
npm start
```
Migration `ota` adds 4 tables: ota_requests, ota_accounts, message_templates, reminder_logs. Nothing else in the
database changes. No new script, no new .env value, no new permission.

## What works now
1. **Other sites (Booking.com, Airbnb…)**
   - Business: Listings → "Other sites" drawer ask / reply / stop (business/backend/src/modules/ota/routes.ts, OtaPanel.jsx → LiveOtaPanel.jsx).
   - Admin → Channels (LiveChannels.jsx, admin/backend/src/modules/channels.ts): the queue, a request drawer (start setup, ask the business, mark live with property id and link, reject, pause), partner accounts (connect / disconnect), site settings (on/off, site %, Sheetal %, mark-up, payout days, photos needed, business types).
   - Statuses: requested, setting_up, needs_info, live, paused, rejected. The business gets a bell and an email at every step (wording is editable in Messages: "ota_update").
   - A site can only be asked for when its partner account is Connected AND the site is switched on AND the business type is allowed AND the listing is a stay with enough photos.
2. **AI hub (Admin → AI)**: per-plan switches for listing from text, lead finder, blog writer, reply suggestions; credits per plan; one Ask AI switch; this month's use per business (LiveAiFeatures.jsx, admin/backend/src/modules/ai-features.ts, domain/ai-features.ts). Credits are shared with the Setup center's AI box (saving either updates both; aiClient reads them).
3. **Messages (Admin → Messages → Templates)**: every system email with its {{placeholders}}; edit, preview with sample values, send yourself a test, switch off, reset to built-in. A saved wording replaces the built-in text; no row means the old text, word for word (a test proves it for the emails I could compare).
4. **Expiry reminders (Admin → Messages → Expiry)**: plan renews soon (no auto-pay), listings not updated, boost ends tomorrow, banner ends tomorrow. Owner gets a bell and an email; ReminderLog stops repeats. Daily job runs hourly and sends after 9 am Nepal time; "Send today's now" button; JOBS=off turns the job off like the others.
5. The old sample **Ads** screen is removed (route, menu item, AdminAds and its constants). /admin/promote is the live page; signed out it shows a one-line notice.

## Files
New: backend-core/src/domain/{ota-requests,ai-features,templates,reminders}.ts; admin/backend/src/modules/{channels,ai-features,templates,reminders}.ts; business/backend/src/modules/ota/routes.ts; admin/frontend/src/pages/{LiveChannels,LiveAiFeatures,LiveMessages}.jsx; business/frontend/src/pages/LiveOtaPanel.jsx; tests admin/backend/test/{ota,ai-features,templates,reminders}.test.ts and business/backend/test/ota.test.ts.

Changed (shared files marked *):
- backend-core/prisma/schema.prisma * : 4 models added at the END of the file (nothing else touched). OtaRequest also has `price` and `note` (the mark-up and the business's note), which your list didn't name.
- backend-core/src/domain/billing.ts : `ownerOf` is now exported; the plan/banner/boost payment emails and the renewal, past-due and moved-to-Starter emails name their template (text unchanged).
- backend-core/src/lib/mailer.ts : an Email may carry `template: { key, vars }`; Mailer.send swaps in the saved wording when there is one. verify / reset / welcome-back name theirs.
- backend-core/src/lib/ai.ts : aiClient reads credits from "ai.features" first.
- backend-core/src/lib/files.ts : new private file kind "ota" (PDF or photo, 8 MB).
- admin/backend/src/modules/insight.ts : the Setup center's AI credits read and save through ai.features.
- admin/backend/src/modules/routes.ts : tenant-ready (x2) and staff-added emails name their template.
- business/backend/src/modules/growth/routes.ts : lead finder checks the plan's switch (403 with a plain message).
- website/backend/src/modules/insight/routes.ts : Ask AI checks its switch (503 when off).
- admin/backend/src/app.ts * , business/backend/src/app.ts * , admin/frontend/src/pages/AdminApp.jsx * : see below.
- admin/frontend/src/pages/AdminExtras.jsx : AdminAds and its SLOTS / RANK / CAMPAIGNS constants removed (nothing else used them).
- business/frontend/src/pages/OtaPanel.jsx : the old components are now SampleOtaCell / SampleOtaDrawer; OtaCell / OtaDrawer pick live or sample.

### Exact lines in the shared files
admin/backend/src/app.ts: add after the `adminPlatformRoutes` import
`import { adminChannelRoutes } from "./modules/channels.js";`
`import { adminAiFeatureRoutes } from "./modules/ai-features.js";`
`import { adminTemplateRoutes } from "./modules/templates.js";`
`import { adminReminderRoutes, startReminderJob } from "./modules/reminders.js";`
add after the `adminPlatformRoutes` register line
`  await app.register(adminChannelRoutes, { prefix: "/v1" });` (and the same for adminAiFeatureRoutes, adminTemplateRoutes, adminReminderRoutes)
and change the jobs line to `{ startBillingJob(app); startOtaJob(app); startReminderJob(app); }`.

business/backend/src/app.ts: add `import { otaRoutes } from "./modules/ota/routes.js";` after the growth import and
`  await app.register(otaRoutes, { prefix: "/v1" });` after the growthRoutes register line.

AdminApp.jsx: remove `AdminAds` from the AdminExtras import; add imports of LiveChannels + useOtaWaiting, LiveAiFeatures, LiveExpiry + LiveTemplates;
`const PREVIEW = ["/admin/voice", "/admin/social"];`; add `const otaWaiting = useOtaWaiting(isStaffLive() && can(role, "tenants.view"));` before `pending`;
delete the `/admin/ads` menu item and route; the Channels menu count uses otaWaiting when live; the three hub tabs and the /admin/channels route use the live pages when `isStaffLive()`.

## Read before merging: not finished or assumed
1. **Branch removal**: requests carry a branchId, but business/backend/src/modules/branches/routes.ts was not in the zip. Add: a branch with open requests (status requested, setting_up, needs_info or live) can't be removed.
2. **Billing already sends plan reminders** (default 7 and 1 days before). This job skips any day billing covers, so with the default 7/3/1 the only extra email is the 3-day one. If you change billing's reminder days the overlap follows automatically.
3. **Listings have no expiry date** (the "expired" status exists but nothing sets it; "Check-ups" is a different thing). "Expires" is therefore "not updated for N days" (default 90, set in Expiry). I used the listing's updatedAt.
4. **Stopping on a site**: "Stop selling" sets the request to paused at once and rings the team; the team must take the page down on the site by hand. The old sample's "stop_requested" and "declined" are now paused and rejected.
5. **AI switches I cannot enforce**: only the lead finder and Ask AI exist in this zip. Listing from text, blog writer and reply suggestions are saved but nothing checks them yet: call `await requireAiFeature(db, plan.name, "blog_writer")` (domain/ai-features.ts) at the top of those routes. Ask AI has no plan (visitors), so it is one switch for everyone, not a per-plan one. The Voice tab is still sample.
6. **Templates**: wired = verify, reset, welcome-back, plan/banner/boost payment, renewal, past due, moved to Starter, tenant ready (x2), staff added, other-sites update, 4 reminders. Not in the zip, so not wired: agreement signing / OTP and form emails and anything else sent from files I didn't have (add `template: { key, vars }` to their mailer.send and a definition in domain/templates.ts). SMS and WhatsApp wording can be saved but nothing sends them. Nepali copies are stored, but no sender passes a language yet, so English is what goes out.
7. **Business OtaCell** decides "live" by the listing id being a whole number (server ids are; sample ids are not). If your live listing objects differ, change `isLiveListing` in LiveOtaPanel.jsx.
8. Assumed from code I could see, not checked: `ws.member.tenant.name/.type`, `AppError` having `statusCode` and `code`, `app.mailer`, the listings table being named `listings` (a raw UPDATE in reminders.test.ts), Listing needing only code/slug/purpose/category/title, and the Table / Drawer / Tabs / ToggleRow props as used elsewhere (ToggleRow with an empty title inside tables).
9. Reply files go to MEDIA_DIR/private/ota and are shown to staff as base64 (same as rent proofs). They are only served when the request's log names the file.
10. "Pre-Launch Phase.dc.html" was not in the zip; no checklist rows were ticked.
11. Calendar sync (OtaFeed, the 2-hour job) is untouched.
