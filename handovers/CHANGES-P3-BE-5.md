# CHANGES P3-BE-5: the subscription lifecycle job

Phase 3, stage 7. MB sections 5.1, 5.5 and 8.3. Runs every hour for businesses on `billingMode = apps` (none yet), so nothing changes for anyone.

## What changed
| File | What |
|---|---|
| `platform/src/billing/lifecycle.ts` (new) | `runSubscriptionLifecycle()`: (1) a status the dates already decided (past due, ended on the free edition, read-only, trial ended) is stored once, with one history row and a note to the owner; (2) once a paid period is 7 days from its end, ONE open renewal invoice per business through `quote()` for every app due, with price protection and a waiting downgrade; cancelled ones get none; (3) reminders at 7 and 1 days, once per period. One business failing never stops the others |
| `platform/src/billing/invoice.ts` | a paid renewal clears the waiting downgrade / period switch |
| `admin/backend/src/jobs.ts`, `admin/backend/src/modules/billing.ts` | job `billing.subscriptions` (hourly) in the platform job list (today's pinned job list is unchanged) |
| `backend-core/src/domain/billing.ts` | today's plan renewal cycle skips businesses on `apps` (so a moved business is never downgraded to Starter by the old job) |

Access never waits for this job: every request works it out from the dates (`effectiveStatus`). Mails (besides the in-app notes) come with the screens (FE-2).

## Tests
`platform/test/billing-lifecycle.test.ts` (fake clock): one renewal invoice 7 days before (never twice), reminders at 7 and 1 days, past due then ended on the
free edition, a paid-only app goes read-only, cancelled not renewed, co-termed apps on one invoice with the protection line, a waiting downgrade at the
catalog price, a business on plans untouched.

## Go back
Revert the PR (no business is on `apps`).
