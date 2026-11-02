# Old backend audit (Laravel, sheetalproperty.com)

Reviewed 2026-11-02 from the full server backup (`Desktop\sheetal-laravel`): ~22,500 lines of PHP (55 admin + 12 API controllers, 16 services, 11 scheduled commands, 4 queued jobs, 2 model observers, 74 models, 8 email templates), the Node `whatsapp-service` (Baileys) and the Python `voice-agent-worker` (Pipecat).

Each line below is a rule the new Node + TypeScript backend **must keep**, with where it goes. Nothing here is copied as code; it is rebuilt cleanly.

---

## 1. Keep: business logic

### Leads and inbox → `leads` module
- [ ] **One lead per contact per channel per business.** Find by (channel, contact id, business); create if new. Incoming message → lead marked unread and "stale alert" cleared; outgoing reply → stale alert cleared.
- [ ] **Read phone and email out of message text.** Emails by pattern; phones 7–15 digits, skip dates (`2025-01-02`, `02/01/2025`), strip `977` from 13-digit numbers, de-duplicate. A number typed by staff (`manual_phone`) always wins over a detected one.
- [ ] **Nepal phone format**: 10 digits starting 98/97/96 → prefix `977`. Never change WhatsApp ids that already contain `@` (e.g. `@lid` masked contacts).
- [ ] **Reply from the dashboard** on the lead's own channel (WhatsApp / Messenger / Instagram); website-form leads have no reply channel (allow-list, not block-list). Save every sent reply into the conversation.
- [ ] **Echo de-duplication**: remember the id of a message we sent for 30 s so Meta's "echo" of it isn't saved twice.
- [ ] **Contact names** from Meta looked up once and cached 6 h.
- [ ] **Stale lead alert**: hourly, leads still "new" whose last message was from the customer and unanswered 4 h+ → notify the assigned person once.
- [ ] **Follow-up reminders**: every 5 min, leads whose follow-up time has come → notify once (with the note).
- [ ] Lead statuses, tags, follow-up date and note, activity log, CSV export/import.

### Requirements (buyer demands) and matching → `requirements` module
- [ ] **Budget text to number**: understands `Rs`, `NPR`, `₹`, commas, `/-`, and `crore/cr`, `lakh/lac/l`, `million/mn/m`, `thousand/k`; adds parts (`1 crore 20 lakh`).
- [ ] **Requirement fee** (default Rs. 500): buyer pays (QR / proof upload) → staff confirm → requirement marked paid → notify buyer (WhatsApp + email), the assigned agent (WhatsApp + email with full requirement), and the admin (WhatsApp).
- [ ] **Agent's own requirement form link**: each agent has a public form with their logo, a form builder (which fields show), their own fee, QR and bank details; the agent confirms payment.
- [ ] **Match a listing to a demand**: only your own listing; no duplicate (same demand + same listing); email the buyer; create a lead for the matching agent; notify the admin.
- [ ] **Matchmaking**: correct misspelt areas against the real area list from listings (edit distance ≤ 30% of the word, minimum 2), budget window **80%–120%** of the buyer's range, same purpose (buy/rent); agents see only their own listings.

### Listings → `listings` module
- [ ] **Keep every old code** (`SP-0006` … `SP-3206`); new codes continue the series, generated safely (database sequence, not "max id + 1").
- [ ] **Web address** = `name-location-id` slug; keep old slugs so shared links work.
- [ ] **Visible to the public** only when not sold **and** not expired.
- [ ] **Expiry reminder**: daily 09:00, listings expiring in 7 days → in-app + email to the owner.
- [ ] **Featured order**: inserting at a position pushes the others down; gallery photos keep an order that closes gaps on delete.
- [ ] **Plan listing limit** counted per month; deleting a listing gives the slot back; upgrade resets the month's count.
- [ ] **Watermark**: dark strip along the bottom with `sheetalproperty.com` repeated; **keep the untouched original** and make watermarked sizes from it (feature: fit 1200×900; gallery: cover 940×500; thumbnails).
- [ ] **Search filters**: keyword over name/town/tole/district/street/location/municipality/ward; purpose; type; category; min/max price (sale, rent or selling price); posted between dates; min bedrooms/bathrooms/floors/parking; land sqft range; featured only; hide sold; sort by price; max 50 per page.
- [ ] Listing preview page; documents per listing; reviews with moderation.

### Visitor tracking and bots → `analytics` module
- [ ] **Bot filter**: block known bots/crawlers/AI scrapers/HTTP libraries/headless browsers/monitors, very short user agents (<20 chars) and requests without `Accept-Language`. (New: still *serve* Google/Bing; only keep them out of visitor counts.)
- [ ] **Flood limit**: more than 60 page views per IP in 10 min are not counted.
- [ ] **Data-centre IPs** (hosting) are not counted; IP → country/city cached 24 h.
- [ ] **Same page again within 30 min** by the same visitor counts once.
- [ ] **Live visitors**: session heartbeat every 20 s; page name resolved for listings and blog posts.
- [ ] One-off clean-up command to remove bot visits from history.

### WhatsApp → `whatsapp` module
- [ ] **Per-business linked phone (QR)**: status, QR, list groups, **create group**, choose alerts to **own chat or a group**, reconnect, log out.
- [ ] **Alerts with a photo** (listing image attached) to own chat or group; if the business has no linked phone, queue a normal message to their number instead.
- [ ] **Messages to buyers** go out from the agent's own linked phone when connected, otherwise from Sheetal's.
- [ ] Incoming messages from the linked phone service arrive at a webhook protected by a shared secret header and become leads for the right business.

### Social sharing → `social` module
- [ ] Facebook login → long-lived token → choose page → subscribe page to messages; Instagram business account from the page.
- [ ] **Post a listing**: Facebook page with one or several photos; Instagram single photo or carousel; caption built from the listing (HTML → plain text); custom caption allowed.
- [ ] **Scheduled posts** run at their time and save each platform's result.

### AI → `ai` module (provider-agnostic; Sheetal's key or the business's own)
- [ ] **Fallback model**: if the main model is retired or times out, retry once on the fallback model and log it.
- [ ] **Ask AI** prompt (answer about 1–4 listings; compare only when asked; short replies to small talk; no invented facts; under 150 words; plain text).
- [ ] **Listing from text** prompt (Facebook-style Nepali/English/emoji posts → strict JSON: location, ward, municipality, land in aana/ropani/kattha/dhur/bigha/sqft, floors, rooms, road width and type, price + original price text, contacts, highlight, clean description, notes; null when unsure). **Also use it in the import to fill missing fields of old listings from their descriptions.**
- [ ] **Lead finder** from pasted chats; **AI blog** generated in the background with status the browser polls, Unsplash cover image; scheduled AI blog posts publish automatically.
- [ ] **Birthday wishes**: 08:00 daily to team members whose birthday is today, AI-written with a plain fallback.

### Voice assistant → `voice` module
- [ ] Browser calls (WebRTC) to the voice server; the server fetches the assistant's context (name, greeting, knowledge, instructions, listings) from the API.
- [ ] Assistant scope: **personal** (one agent's listings) or **site** (all public listings); listing summary line per property.
- [ ] Several voices per language picked at random so callers don't always hear the same voice.

### Plans, fees and payments → `billing` module
- [ ] Upgrade request with a reference number → payment → plan active for the period → notification. (New: also **automatic** expiry and grace period, see §2.)
- [ ] **Contact / lead fee split**: a fee paid by a buyer is split between Sheetal and the agent by percentage per plan (old: Sheetal % and Bronze/Silver/Gold/Platinum %). See question 2.
- [ ] Agent earnings view.

### Accounts → `auth` module
- [ ] Register, log in, verify email (link), resend, change email and resend, reset password by emailed code, change password, profile, favourites, mark own listing sold.
- [ ] 112 permissions in 46 areas map onto the new role system (business roles + staff roles); nothing in the old list is missing from `rbac.js` except: **Deals**, **Earnings**, **Lead Extractor**, **Voice Agent**, **WhatsApp/Social Connect**, **Requirement Fee Payment** → add as permissions.

### Emails to rebuild (8)
Agent lead received · Agent new requirement · Client requirement received · Demand match · Requirement payment approved · Property expiry · Birthday wish · Password reset code.

---

## 2. Fix: problems found in the old code

| # | Problem | Risk | New backend |
|---|---|---|---|
| 1 | **Fonepay check returns "verified" when Fonepay keys are missing** | Anyone could fake a payment | Never pass without a real confirmation; fail closed |
| 2 | **Khalti amount comes from the browser**; uses Khalti's old v2 verify API | Underpayment | Server sets the amount; Khalti ePayment (initiate → lookup by pidx) |
| 3 | **No signature check on Meta webhooks** (`X-Hub-Signature-256`) | Fake messages/leads | Verify every webhook signature |
| 4 | **Facebook Lead Ads only logged, never saved** | Lost leads | Save as leads |
| 5 | WhatsApp Cloud webhook handles **text only**; errors swallowed | Lost photos/voice notes | Media, locations, buttons; errors to the error log |
| 6 | **Plan expiry never enforced** (`plan_expires_at` stored, never checked) | Free paid plans forever | Hourly job: grace period → back to Starter |
| 7 | Property code = `max(id) + 1` | Duplicate codes under load | Database sequence |
| 8 | Search = `LIKE '%…%'` on 11 columns | Slow | Full-text index + cached results |
| 9 | Access tokens (Facebook page tokens, WhatsApp) stored in plain text | Leak if the DB leaks | Encrypt at rest |
| 10 | Email verification not required to log in | Fake accounts | Verify before posting or paying |
| 11 | Voice: **English and Hindi only, no Nepali**; **calls not recorded** | Nepali callers; no history | Provider with Nepali (test first); store every transcript |
| 12 | 7 copies of the properties table, a 40k-row visits backup | Clutter | Don't import |

---

## 3. Leave behind
- Repository boilerplate (one per lookup table) and the ~20 lookup tables (types, looks, environments…): replaced by the editable **Listing setup** catalog.
- Backup tables (`properties_backup*`, `properties_recovery_*`, `site_visits_backup_*`), one-off recovery/backfill commands (`RecoverGongabuData`, `FixVisitPages`, `Backfill*`), `demo:cron`.
- OAuth/Passport tables (old login tokens).

---

## 4. Data facts for the import
- 2,680 listings; codes `SP-0006`–`SP-3206`; all posted by `shetalrealestate@gmail.com`.
- **Only 231 are visible on the old site today**: 2,449 have expired (posted mostly 2022–2025), 136 have no expiry; 2 expiry dates are typos (2222, 3024).
- Photos: `public/images/property/original/` has **16,949 untouched originals** (use these); `main/` and `thumbnail/` are watermarked copies. 1 cover and 1 gallery photo are missing.

## 5. Decided: import and check-ups (2026-11-02)
- **All 2,680 listings are imported live.** None are expired on import.
- The import reads each **title and description** (rules + the "listing from text" AI prompt) and puts values in the right **category, type and fields**. Confident values are filled in; uncertain ones are stored as **suggestions** (`suggest: [{ field, label, from, to }]`) for the team to confirm.
- Every listing gets a **check date**, spread out so the oldest and most-incomplete listings come first.
- **Listing check-ups** (every business): the manager picks who checks, 3–5 a day each (more on request, skip allowed); actions: all correct, edit, sold/rented, extend 3/6/12 months, expire, remove. Unchecked listings are asked **3 days before** their date. If nobody checks in time: keep live and keep asking (default) or hide until checked. Owners see who checked what (`checkups` log). Rules: `shared/src/data/checkups.js`; the backend runs the same queue in a daily job.
- Public listing pages show "Information checked on <date>"; team members of the owning business get a quick check bar.

## 6. Questions for you
1. ~~Old listings~~: decided above.
2. **Contact fee** (buyer pays to get the owner's contact, split Sheetal % / agent %): keep it in the new site, with a % per Starter/Business/Pro?
3. **Voice language:** if no provider gives clear Nepali yet, is Hindi + English acceptable at launch?
