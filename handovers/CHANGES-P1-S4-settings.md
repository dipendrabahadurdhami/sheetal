# CHANGES P1-S4 (roadmap stage 1.4: Settings)

One builder. Branch `phase-1/P1-S4-settings`. **No schema change, no migration, no new npm package.**

## What changed and why

| Part | Files | What |
|---|---|---|
| Typed settings store | `platform/src/settings/{types,service,defs}.ts` | A setting is declared once with its schema, default, permissions and guard. `get` (never fails on a bad stored value), `set` (validate, guard, row + audit row in one transaction), `reset`, `history`, 30-second cache. Platform values live in `AppSetting[key]`, business values in `AppSetting["t:<businessId>:<key>"]`. |
| Revenue share | `revenue-share.ts`, setting `platform.revenueShare` | Commission %, per-app and per-gateway overrides, technology-partner split, start date. Whole paisa, nearest paisa half up. A change needs a reason and the start date cannot move back. |
| Revenue report | `revenue.ts`, `GET /v1/admin/reports/revenue` | Today / 7 / 30 days / custom, by Nepal day (UTC+05:45), with the same-length period before and % change. Sums paid invoices and the commission RECORDED on collected payments, in the database. CSV export (audited). |
| Field builder | `field-defs.ts`, settings `platform.fieldDefs.<form>`, `GET/PUT /v1/admin/settings/forms` | Three seeded forms (company profile, business profile, business verification). Rules: archive, never delete; a key's type never changes; locked fields stay. `projectFields()` applies visibility in one place. |
| Theme | `theme-tokens.ts`, setting `platform.theme` | Theme tokens with a readability check (contrast); an unreadable look is refused with the reason. |
| Routes (rule 11) | `platform/src/settings/routes.ts`, registered in `admin/backend/src/app.ts` | `/v1/admin/settings/store…`, `/v1/admin/settings/forms…`, `/v1/admin/reports/revenue`. |
| Screens | `admin/frontend/src/pages/SettingsStore.jsx`, `settingsWords.js` (+test), `AdminApp.jsx` | Admin → Settings → "More settings": Field builder, Theme (with preview), Revenue share and report. |
| Tests | `platform/test/settings-pure.test.ts` (18), `admin/backend/test/settings.test.ts` (database), `settingsWords.test.js` (7) | |

## Not in this stage (said plainly)
- Today's rows `platform`, `billing`, `payments`, `catalog` are **not** moved into the typed store: their screens and readers work unchanged. So `settings:migrate` was not needed and was not written. They move when their screens are redrawn from data.
- The verification flow keeps today's screens and tables (`VerificationDoc`). The `business_verification` form can be edited in the Field builder, but today's flow does not read it yet. New tables (`BusinessVerification`) were not added: that is a schema decision for the owner.
- Business-side settings screens (Profile, Branding from tokens) are Phase 2 by the design. The `business.profile` and `business.theme` settings exist and are tested through the service.
- The saved platform theme is stored and validated, but the panels do not read it yet: applying tokens to every screen is the Phase 4 look-and-feel pass. Nothing changes visually until then.
- The partner share is not stored per payment (that needs two new columns). The report works it out from the recorded commission with the current rule from its start date, and says so on the screen.
- Font library and logo upload in the theme editor are not built.
