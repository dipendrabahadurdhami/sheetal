# Setup guide for the super admin

What to connect, when, and how, step by step. Everything here is done **in the admin panel** (`/admin`), signed in as the super admin,
unless a line says "developer". Short sentences, one step at a time.

## How every connection works (the same four steps each time)

1. Open **Admin → Setup center**. Click the card of the service (for example eSewa).
2. Type the details the card asks for. Press **Save**. A secret (key, token, password) is never shown again after saving: it only says "Saved".
3. Press **Test**. Wait for "Test passed". If it fails, the page says why; fix the detail and test again.
4. Press **Go live**. The card now says **Live**. To stop it later press **Pause**; to remove it press **Disconnect**.

Each card has its own short help on the right side. A change to a connection that is already live is tested first, then replaces the old one.

## The order: what to set up, and when

| # | What | When | Needed for | Where |
|---|---|---|---|---|
| 1 | Company details | **Before the first sale** | Your name, PAN and address on every tax invoice | Admin → Legal and required info |
| 2 | Prices and billing rules | Before the first sale | What apps cost, VAT, trial days, the sales switch | Admin → Pricing |
| 3 | eSewa (then Khalti, Fonepay) | **Before the first sale** | Businesses pay Sheetal for apps | Admin → Setup center |
| 4 | Email (your own mail server) | **Before launch on the internet** | Sign-up emails, password reset, invoices, reminders | Developer + DNS (section 5) |
| 5 | Cloudflare | Before launch | Business websites on their own domain | Admin → Setup center |
| 6 | Google (Analytics, Search Console, Maps) | At launch | Visitor numbers, Google search, maps | Admin → Setup center |
| 7 | WhatsApp | When you want WhatsApp alerts | Lead and payment alerts by WhatsApp | Admin → Setup center |
| 8 | AI (Claude, OpenAI, Gemini, ElevenLabs) | When you want to sell Sheetal AI | AI inside the apps, paid with credits | Admin → Setup center, then Admin → AI settings |
| 9 | Staff accounts | Before launch | Your team signs in with their own role | Admin → Staff and roles |
| 10 | Booking.com, Airbnb calendars | Each hotel does its own | Room calendars stay in step | **Business** panel → Settings → Channels and alerts |

Do 1, 2 and 3 first: they are all you need to sell on this computer. 4 to 6 are needed the day the site goes on the internet.

---

## 1. Company details (do this first)

1. Open **Admin → Legal and required info**.
2. In "Company details on invoices" fill in: trade name, legal name, PAN (9 digits), tick "Registered for VAT" if you are, address, phone, email.
3. Type a reason (for example "first setup") and press **Save company details**.

These are printed on every tax invoice from the moment it is paid. They are never shown on public pages.
On the same page: links to the sale terms and refund policy (Content) and to the details a business must give before buying (field builder).

## 2. Prices and billing rules

1. Open **Admin → Pricing**. Pick an app on the left. Change its price a month and a year, its free limits, its trial days.
2. Press **Who is affected?**, type a reason, press **Save prices**. A price rise that touches paying businesses needs a second staff member to approve.
3. Scroll down to **Billing rules**: the **Sales on** switch (it is on since 16 Nov 2026), VAT %, trial days, grace days, read-only days,
   refund window, reminders. Change, type a reason, **Save billing rules**.

"Shown in the marketplace" on each app hides or shows it. Payroll, Accounting and Restaurant are hidden until they are built.

## 3. Payments: eSewa, Khalti, Fonepay (Sheetal's own, for selling apps)

You need a **merchant account** from each provider first. That part is outside the software:

| Provider | Who gives the account | What they give you |
|---|---|---|
| eSewa | eSewa (ask for an **ePay merchant account**) | a product code and a secret key (a test pair and a live pair) |
| Khalti | Khalti merchant dashboard | a secret key under "Keys" (test keys on the test dashboard) |
| Fonepay | your bank | a merchant code (PID) and a secret key |

Then, for each one:

1. **Admin → Setup center → eSewa** (or Khalti, Fonepay).
2. Choose the **Test details** tab. Type the test product code and test secret key. **Save**, then **Test**.
3. Make one test payment (see the pilot test in `docs/p3-cutover-runbook.md`). No real money moves in test mode.
4. Choose the **Live details** tab. Type the live code and key. **Save**, **Test**, then **Go live**.

Start with eSewa only. Add the others later; nothing else changes. Bank transfer with a proof photo also works with no setup:
staff approve it in **Admin → Billing**.

Each **business** connects its own eSewa, Khalti or Fonepay in its own panel (under Settings) to take money from its
customers. That money goes to the business, never through Sheetal. Their request with documents arrives in the admin panel for your team to check.

## 4. Sales switch

**Admin → Pricing → Billing rules → Sales on.** On = businesses can pay. Off = they can look, install free apps and start trials, but not pay.
If something goes wrong after launch, switch this off first.

## 5. Email (your own mail server) — needs the developer and your domain

Sheetal sends its own email; there is no outside email company to connect. This is set up once on the server, not in the admin panel.
Full steps: `docs/mail-server.md`. In short:

1. Ask the hosting company to **unblock outgoing port 25** for the server (most block it by default).
2. In your domain's DNS add the records the guide lists (MX, SPF, DKIM, DMARC) for `sheetalproperty.com`.
3. The developer sets the mail settings on the server and starts the mail server.
4. Test: send to a Gmail address, open it, "Show original": SPF, DKIM and DMARC must all say **PASS**.

Until this is done, sign-up and password emails are only saved as files (fine on this computer, not on the internet).
A business that wants email on its own domain adds the domain in its panel (Business → Settings → Domain and email); the panel shows the DNS records to add.

## 6. Cloudflare

Needed so a business's website can use its own domain.

1. In Cloudflare open your site. The **zone id** is on the Overview page, on the right. Copy it.
2. In Cloudflare: My Profile → API Tokens → Create Token. Give it **Zone → DNS → Edit** for this one zone only. Copy the token.
3. **Admin → Setup center → Cloudflare**: paste both, **Save**, **Test**, **Go live**.

## 7. Google: Analytics, Search Console, Maps

All three are on one card: **Admin → Setup center → Google**. Fill in what you have; each is optional.

| Field | Where to get it |
|---|---|
| Analytics measurement id | Google Analytics → Admin → Data streams → your website. It starts with `G-`. |
| Search Console verification code | Search Console → add the website → "HTML tag" method. Copy **only the code** inside `content="…"`. |
| Maps key | Google Cloud → create an API key with **Geocoding** and **Maps JavaScript** APIs switched on. |

Then **Save**, **Test**, **Go live**. Do this at launch: Analytics and Search Console need the real website address.

**Sign in with Google is not built yet.** People sign in with email and password. The Google and phone buttons are hidden on the live site.

## 8. WhatsApp

1. In **Meta for Developers** create a **Business** app and add the **WhatsApp** product.
2. Add and confirm your business phone number. Copy its **phone number id** (digits only).
3. In Meta Business settings create a **system user** and give it a token with the WhatsApp permissions (a permanent token, not the 24-hour one).
4. **Admin → Setup center → WhatsApp**: paste the phone number id and the token. **Save**, **Test**, **Go live**.

Meta must approve the business and the message templates before messages reach people who have not written to you first. That can take days.

## 9. AI: Claude, OpenAI, Gemini, ElevenLabs

Sheetal AI is what you sell to businesses as credits. It needs at least one AI account of yours.

1. Get a key (you pay the AI company for use; a chat subscription such as ChatGPT Plus or Claude Pro does **not** include it):
   - Claude: Anthropic Console → API keys → create a key. Add credits first.
   - OpenAI: OpenAI platform → API keys → create a secret key. Add credits under Billing.
   - Gemini: Google AI Studio → create an API key for a project with billing on.
   - ElevenLabs (voice): profile → API keys → create a key with text to speech; also copy a **voice id** (Voices → the voice's menu → Copy voice id).
2. **Admin → Setup center → Claude** (or OpenAI, Gemini, ElevenLabs): paste the key. Leave "Model" empty to use the default. **Save**, **Test**, **Go live**.
3. **Admin → AI settings**: which AI features are on and what each costs in credits.
4. **Admin → Pricing → Sheetal AI plans**: the price and credits of AI Lite, Plus and Max.

One provider is enough to start (Claude is the default). A business can also use **its own** key instead of buying credits:
Business → Settings → AI accounts. Its key is used only for that business and is never shown again.

## 10. Staff accounts and sign-in

- **Your team:** Admin → Staff and roles → add a person with their email and a role (Operations, Finance, Content editor, Support). They get an email
  to set their password, so email (section 5) must work first.
- **Customers and businesses:** they sign up on the website with email and password, and confirm their email from a link. Nothing to set up
  except email.
- **The test accounts** (`…@sheetal.test`) are for this computer only. They must not exist on the real site (the developer leaves them out).

## 11. Booking.com and Airbnb (each hotel, not the super admin)

There is nothing for the super admin to connect. A hotel or host does this in its own panel:

1. In Booking.com or Airbnb, open the calendar settings and copy the **calendar export link** (iCal, it starts with `https://`).
2. **Business** panel → Settings → Channels and alerts → add the link for the room type.
3. Bookings made there then block the same dates in Sheetal. Copy Sheetal's own calendar link back into Booking.com or Airbnb so it works both ways.

This keeps the **calendars** in step. It does not copy prices or guest details.

---

## Not built yet (so you are not surprised)

These are hidden from the screens until they are built. None is needed to launch.

| Thing | State |
|---|---|
| Sign in with Google, sign in by phone (SMS code) | not built; email and password only |
| SMS | not built; WhatsApp and email send instead |
| Bank card gateway | waiting for the bank agreement |
| Fonepay dynamic QR | waiting for the bank's technical pack |
| Facebook and Instagram posting, the "Social sharing" page | not built |
| AI voice assistant page | not built (ElevenLabs voice works inside the apps) |
| Delivery partners (Pathao, Foodmandu, Yango) | not built |
| IRD billing link (CBMS) | not built; every tax invoice is listed as "not sent to IRD" |
| Agoda and Expedia direct links | calendars by iCal link only, like Booking.com and Airbnb |
| Payroll, Accounting, Restaurant apps | not built; hidden from the marketplace |
