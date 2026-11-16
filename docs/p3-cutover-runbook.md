# Phase 3 cutover runbook: from plans to apps

How Sheetal moves every business from Starter / Business / Pro to app subscriptions, one small step at a time, and how to go back.
Design: MARKETPLACE-AND-BILLING.md section 8.6. Risks and the launch gates: PHASE-3-RISKS.md sections 2 and 6. The commands behind the
scripts: [p3-migration-howto.md](p3-migration-howto.md).

**The idea in one line:** first the new rows are written and nothing reads them; then both systems run side by side and are compared;
then a few businesses switch; then everyone. Every step takes a backup first, shows a preview, and writes only after a typed `YES`.

## The three modes of a business
| Mode | Who answers "what may this business do?" | What the business sees |
|---|---|---|
| `plans` | the old plan (today) | no change |
| `shadow` | the old plan; the new system is worked out beside it and every difference is recorded | no change |
| `apps` | the new system | the marketplace, the new billing page |

## Before you start (once)
| # | Do | Expect |
|---|---|---|
| A | `.\scripts\ops\RUN-P3-STEP-1.cmd` | five green OK lines; `Desktop\p3-price-report.csv` |
| B | Read the price report. Change prices in Admin → Pricing if you want, then run step A again | the report shows the new prices (gate G2) |
| C | `.\scripts\ops\RUN-P3-STEP-2.cmd` | nine green OK lines: the whole cutover and the way back work on a copy (gate G8) |
| D | Admin → Legal and required info → "Company details on invoices": legal name, PAN, address | saved |
| E | Businesses listed as SKIP "a plan payment is in flight": approve or fail that payment in Admin → Billing, then run step A again | 0 skipped for that reason |

Steps A and C never change the real data. They can be run any time, as often as you like.

## The cutover (real data)
Close the server windows before each step and start them again after. One step, then stop and look.

| Step | Run | What happens | Who sees a change | When |
|---|---|---|---|---|
| 1 | `.\scripts\ops\RUN-P3-CUTOVER-1.cmd` | backup; the migration proves (P1 to P8) and writes each business's app rows | nobody | any time after A to E |
| 2 | `.\scripts\ops\RUN-P3-CUTOVER-2.cmd` | backup; every business with app rows moves to `shadow` | nobody | after step 1 |
| wait | `.\scripts\ops\RUN-P3-CUTOVER-STATUS.cmd` each day; Admin → App billing → shadow | the list ends with PASS; "less" stays 0 | nobody | **7 days** |
| 3 | `.\scripts\ops\RUN-P3-CUTOVER-3.cmd` | backup; the pilot businesses you name move to `apps`; their open plan invoices are voided | the pilot | Sheetal's own business first, then up to 5 |
| pilot test | switch sales on (Admin → Pricing → Billing rules) and do the pilot hand test below | invoice `INV-2083-84-0001`, VAT shown | the pilot | until gate G10 is ticked |
| 4 | `.\scripts\ops\RUN-P3-CUTOVER-4.cmd` | backup; **every** business with app rows moves to `apps` | everyone | after the 7 days and the gates below |

Each script writes `Desktop\p3-cutover-<step>-report.txt`. Send a screenshot of the window after each step.

### The pilot hand test (PHASE-3-TEST-PLAN.md section 3)
With the pilot business, signed in with its owner account: install a free app; start a trial; buy two apps in one payment with the eSewa
test merchant; open the invoice; change an edition; cancel and undo. Expect: one tax invoice numbered `INV-2083-84-0001` with VAT shown,
and the Subscriptions page showing the same apps and dates.

### What a step refuses (and why that is right)
| It says | Meaning | Do |
|---|---|---|
| `the migration has not written its app rows` | the business was skipped by the migration (suspended, demo, payment in flight) | it stays on plans; fix the reason, run step 1 again |
| `on shadow for N day(s); it needs 7` | step 4 too early | wait, or use step 3 for a pilot business |
| `the app answer gives less than the plan today` / `recorded difference(s)` | the new system would take something away | **stop**; send the report; never force this |
| `a plan payment is in flight` | someone is paying an old invoice right now | approve or fail the payment, then run the step again |
| `it bought or installed something on the new system, so it stays on apps` | going back would take away what it bought | switch sales off and fix forward (below) |

## The launch gates (PHASE-3-RISKS.md section 6): tick each before step 4
| Gate | Check | How |
|---|---|---|
| G1 | The five owner questions answered | done 13 Nov |
| G2 | Price report read; prices entered in Admin → Pricing | steps A and B |
| G3 | Revenue split entered (commission, partner share); a test sale shows the right entries | Admin → Pricing; Admin → App revenue after the pilot sale |
| G4 | Dry run on a copy PASS; shadow 7 days with zero "less" | step A; the status script |
| G5 | The accountant confirmed the invoice wording, time of supply, credit notes, IRD, BS dates | outside the software |
| G6 | One Sheetal payment method live; a real test payment refunded | Admin → Integration Center; Admin → App billing → Refunds |
| G7 | Sale terms, refund policy, invoice footer entered | Admin → Legal and required info |
| G8 | Backup taken and a restore rehearsed on the copy | step C |
| G9 | Fiscal year start (Shrawan 1) checked against the official calendar | Finance |
| G10 | The pilot ran one full cycle: trial, purchase, upgrade, cancel, refund | the pilot hand test, plus one refund |

## Going back
| Where you are | Go back with | Loses |
|---|---|---|
| After step 1 only | `npm run billing:migrate -- --restore` | nothing (removes only the migration's rows) |
| After step 2 (`shadow`) | `.\scripts\ops\RUN-P3-GO-BACK.cmd`, type `ALL` | nothing |
| After step 3 or 4, **before any sale** on the new system | `.\scripts\ops\RUN-P3-GO-BACK.cmd` (ids, or `ALL`) | nothing. Plan invoices that were voided stay void; a new one is made at the next reminder or when the business pays from its Billing page |
| After a business **bought or installed** on the new system | not for that business. Switch sales off (Admin → Pricing → Billing rules → sales), keep it on `apps`, fix the problem | nothing: it keeps what it bought |
| Disaster only | `npm run restore -- <backup name> --yes` with the backup the step printed | **everything since that backup**, for every business |

The old plan, its renewal date and its period are never changed by any step, which is why going back is safe.

## Every year (Finance, before Shrawan 1)
1. Check the new fiscal year's start date against the official calendar (invoice numbers restart: `INV-2084-85-0001`).
2. Check the VAT rate in Admin → Pricing → Billing rules.
3. Ask the accountant whether the IRD rules for invoices changed.

## If something looks wrong
Stop. Do not run the next step and do not use `--force`. Send the report file from the Desktop and a screenshot. Every step is safe to
run again: a business that already moved is listed as "already on …" and is not written twice.
