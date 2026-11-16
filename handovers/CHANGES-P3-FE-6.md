# CHANGES P3-FE-6: the AI screens

Phase 3, stage 18. MB section 10, on BE-8. Only a business on `billingMode = apps` sees the new page; businesses on plans keep today's AI accounts page.

## New page: Business → Settings → AI (`/business/ai-accounts` on `apps`)
- **Where AI stands**: off (apps show a preview), Sheetal AI on (credits), or the business's own account on.
- **Sheetal AI credits** (`GET /v1/ai/credits`, billing people): credits left, used this month, Sheetal AI uses and own-key uses, first expiry, a meter.
- **How AI is used**: "Use first" (any connected account, Claude, OpenAI or Gemini) and **"If my own key fails, use Sheetal AI credits"** (off by default).
- **Sheetal AI plans** (Lite, Plus, Max from the catalog), monthly or yearly → **Add to cart**: one payment with the apps (Cart.jsx).
- **Your own AI accounts**: Claude, OpenAI, Gemini, ElevenLabs voice: key (write-only, password field, cleared after saving, never shown again),
  model or voice id, Save → Test → Switch on, Pause / Resume, Disconnect (the key is deleted).

## Server (small, additive)
- `platform/src/billing/catalog.ts`: `SHEETAL_AI_APP = "sheetal_ai"` and `withAiApp(catalog)`: the AI plans as one **hidden** app (each plan a paid
  edition), used only by the business marketplace routes. So the cart's `quote()`, the invoice, the payment and the lifecycle job sell and renew a plan
  exactly like an app, and `aiAllowance()` (BE-8) already reads that subscription. Hidden: never a marketplace card; install and trial answer 404.
- New `business/backend/src/modules/aicredits/own-keys.ts` (**registered in `business/backend/src/app.ts`**): `GET /v1/ai/connections`,
  `PUT/POST/DELETE /v1/ai/connections/:id[/test|/go-live|/pause|/resume]` (the Integration Center's IntegrationService at scope "business", the four AI
  ids only) and `PUT /v1/ai/settings` (`business.ai`). Permission `workspace.settings.update`; read-only support sessions refused; 20 saves and 10 tests
  an hour. Bodies in `aicredits/bodies.ts`.

## Tests
- `business/backend/test/ai-own-keys.test.ts` (5, DB): permission; the four listed with no key; a saved key is never in any answer; another business
  doesn't see it; only the four ids; a stray field refused; a refused key fails the test and can't go live; disconnect deletes the keys; `business.ai`
  per business (voice can't be the preferred text AI) and shown in `/ai/credits`; a Sheetal AI plan quoted at the catalog price, not a marketplace card,
  not installable.
- `business/frontend/src/pages/aiLogic.test.js` (6): every body parsed with the API's own rules; the plan item passes the cart rules; the meter and
  state equal the server's; key fields write-only; the page only on `apps`.
- Run on the owner's PC: business API 432/432, platform 321/321, front-end 169/169, lint, typecheck, business build.

## Not in this stage
- **Top-up** (one-time credits): needs its own quote item (not a period); the page shows its price and "opens with the next billing update".
- **AiLocked on each app's AI buttons**: those features (Ask AI, lead finder) still call the old `aiFor()` on the server (BE-8); each gets the
  locked preview when it moves to `runAi()`, so the screen and the server never disagree.
- Trial credits for new free businesses (owner's answer Q4): with the cutover (OPS-1/OPS-2).

## Hand test (pilot business on `apps`)
Settings → AI: "AI is off". Paste a real Claude key → Save → Test → Switch on: "Your own AI account is on". Disconnect → back to off.
Add AI Lite to the cart with an app → pay with the eSewa test merchant → credits appear (the next lifecycle run adds the month's credits).

## Go back
Revert; or keep the business on `plans` (today's AI accounts page shows).
