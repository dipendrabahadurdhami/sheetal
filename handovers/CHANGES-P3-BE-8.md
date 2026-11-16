# CHANGES P3-BE-8: AI credits and the provider router

Phase 3, stage 10. MB section 10; INTEGRATIONS.md sections 2.1, 2.2 and 13 (rows 11 to 13). No customer sees a change: every business is still
on `billingMode = plans`, where the old `aiFor()` (backend-core/src/lib/ai.ts) is untouched.

## New
- `platform/src/integrations/providers/ai.ts`: **Claude, OpenAI, Gemini and ElevenLabs are built** (same ids and fields as the four shells, so
  saved details stay). `test()` = a one-token completion (ElevenLabs: the voices list + voice id). `complete()` / `speak()` over plain HTTPS
  through the guarded fetch; errors become `AiCallError` (key, busy, request, down) with the key hidden. One file for the four (they share the
  error and request code). Default models can be replaced in each connection's Model field.
- `platform/src/billing/ai-credits.ts`: `creditsFor()` (text/vision per 1,000 tokens, at least 1; voice per started minute; `catalog.ai.creditRates`),
  `creditBalance()`, `spend()` (row locks, first-expiring first; 402 `ai_credits_used`), `giveBack()`, `addGrant()` (idempotent with `ref`),
  `aiAllowance()` (a Sheetal AI plan = subscription `appId "sheetal_ai"`, editionId = plan key; one grant per month of the period).
- `platform/src/ai/router.ts`: `chooseRoute()` (pure), `aiStateFor()`, `aiStateQuick()` (database only, for every request), `runAi()`:
  own key (preferred first; the older `ai.tenant.<id>` key counts as Claude) → else Sheetal AI (credits + a live platform AI connection) →
  else locked (the preview, no call, a usage row "preview"). Sheetal AI takes the credits of the largest possible answer **before** the call,
  gives back the unused part after it and everything when it fails. A failing own key answers 503 `ai_key`; only `business.ai.fallbackToSheetal`
  (off by default) lets it continue on Sheetal credits. One `AiUsage` row per call (appId, provider, source, requestId).
- `platform/src/ai/settings.ts`: the business setting **`business.ai`** `{ preferred, fallbackToSheetal }` (registered in SETTING_DEFS; the pinned
  business list in `platform/test/settings-pure.test.ts` now includes it).
- `IntegrationService.contextFor(owner, id)`: the same usable check as `resolve()`, as the provider context (additive).
- Business `GET /v1/ai/credits` (`business/backend/src/modules/aicredits/routes.ts`, **registered in `business/backend/src/app.ts`**): state, balance,
  live grants, this Nepal month's use; `workspace.billing.manage` only.
- Admin `POST /admin/subscriptions/:tenantId/ai-credits` `{ credits, days, reason }` (gift; `platform.subscription.grant`; audited).

## Changed
- Entitlements v3 `ai(appId)` answers the real state (was always "locked"); the loader adds `aiStateQuick()` (a failure there answers locked).
  `GET /v1/entitlements` also returns `ai`.
- Lifecycle job: a `sheetal_ai` subscription only gets its monthly credits (`aiAllowances` in the summary); it skips the app steps.
- `platform/test/integrations-pure.test.ts`: the pinned list of built integrations now includes the four AI providers.

## Not in this stage (written down for later)
- Buying a Sheetal AI plan or a top-up in the cart (quote items) and its renewal: with FE-6 / a small BE follow-up. Trial credits for new
  businesses: with the migration (BE-10) or that follow-up. Voice routing through `runAi` (the ElevenLabs provider is ready).
- Existing AI features (Ask AI, lead finder) still use `aiFor()`; each moves to `runAi()` when its app is on `apps`.

## Tests
`platform/test/ai-credits.test.ts` (DB): credit rates; first-expiring first, expired never spent, give back exactly; 20 parallel spends never
overspend; allowance once per month inside a yearly period; route choice; locked = preview, no call, 0 credits; Sheetal AI charges what was used,
a call that can't be covered never reaches the provider; a failed call gives everything back; own key takes no credits, fails clearly, falls
back only with the owner's switch; neither key appears in errors, answers, usage rows or logs.
`platform/test/integrations-pure.test.ts`: key only in a header, refused key hidden for all three text providers, ElevenLabs voice check, no key no call.
`business/backend/test/ai-credits.test.ts`: state locked → sheetal → own_key; `/ai/credits` for billing people, per business.
`admin/backend/test/billing-admin.test.ts`: the AI credit gift.

## Owner
Nothing to run. To try Sheetal AI later: Admin → Integrations → Claude: paste Sheetal's key, Test, Go live.
