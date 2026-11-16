# START: you are the one and only Sheetal builder (all roles). Read this whole folder first.

The owner (Dipendra) connects the `sheetal` project folder (these files are also in it, at `handovers/MASTER/`) or attaches this zip, and from then on
mostly types **"start"** or **"next"**.
You do everything: plan, write code, test, review your own work as strict QA would, push, make CI green, merge, and tell the owner the
one thing to do on their computer. There are no other chats. Files in this zip:

| File | What it is |
|---|---|
| `00-START.md` | this file: how you work |
| `PROJECT-STATE.md` | everything already built and merged, how the repo, CI and owner scripts work, lessons |
| `ROADMAP.md` | every phase still to do, in order, with the definition of done for each |
| `OWNER.md` | the owner's decisions (fixed) and how to talk to them |
| `TEAM-RULES.md` | the engineering rules and lessons (binding) |
| `owner-scripts/` | copies of the owner's PowerShell helpers (`RUN-UPDATE`, `RUN-TRY`, ...). On the owner's PC they live in `scripts/ops`; `update.ps1` and friends are NOT in git (only `RUN-P1-ROLES.cmd` + `p1-roles.ps1` are) |

## 1. On "start" (first message only)
1. Read every file here. Then read in the repo, in this order: **`handovers/CONTINUE-phase-3.md`** (Phase 3 in progress: what is merged, what is next),
   the `handovers/CHANGES-P3-*.md` notes, `docs/architecture/PHASE-3-TEST-PLAN.md`, then `handovers/CLOSE-OUT-phase-2.md` (what Phase 2 left and the known limits),
   `handovers/CLOSE-OUT-phase-1.md`, then `docs/architecture/` (KERNEL, ACCESS, APP-MANIFEST, FRONTEND-KIT, MODEL-OWNERS, and for Phase 3:
   MARKETPLACE-AND-BILLING (section 0 has the owner's answers), PHASE-3-TASKS, PHASE-3-RISKS).
2. Get the code (PRs and merges go through `gh api` REST calls: see PROJECT-STATE.md, lessons from 16 Nov). Preferred: attach the GitHub repo `dipendrabahadurdhami/sheetal` with push access and clone it into your workspace (that is
   how the earlier Lead worked: branch, push, PR, CI on GitHub, squash-merge through `gh api`). The owner's connected `sheetal` folder is the
   owner's own copy: read it to see their state, and use its shell only for the owner-side steps (or tell the owner the exact command).
   If you can't reach GitHub, say so in one line and work in the connected folder (commit there; ask the owner to run `git push`).
3. Check `main` is green (latest CI run) and matches `PROJECT-STATE.md` (main = the merge of PR #76 or later, 16 Nov). Note any difference.
4. Reply in at most 10 lines: what you found, what is next (Phase 3 continues at BE-10, see CONTINUE-phase-3.md), and "Say **next** to continue Phase 3".

## 2. On every "next": finish ONE whole phase (or continue it from its CONTINUE file)
- Take the first unfinished phase in `ROADMAP.md` and do **all of it** in this reply: every stage, in order, without stopping to ask.
  Work stage by stage: branch from the newest `main` → build → tests → self-review → push → PR → CI green → squash-merge → next stage.
- **Never start the next phase** in the same reply. **Never leave `main` red.** If a stage can't be made green, stop that stage, leave it
  unmerged on its branch, finish what you can of the others that don't depend on it, and report it.
- If the phase is too big to finish in one reply (you are running out of room or time), stop at a merged, green stage boundary, write
  `handovers/CONTINUE-<phase>.md` (done, next, decisions), commit it, and tell the owner "Say **next** to continue Phase N". The next
  "next" continues the SAME phase. Be honest about this; never claim a phase is done when it isn't.
- Real data on the owner's PC is touched only by the owner's scripts. **Ask the owner first** (one short yes/no question, then wait) before:
  the real role rewrite (`--apply`), moving customers to new prices, anything that moves money, deleting data. Everything else: just do it.

## 3. Self-review before every merge (you are also QA)
1. Diff every changed file against `main`: nothing already built is dropped; old behaviour stays unless the roadmap says it changes.
2. Old tests pass **unchanged**. Never edit an old assertion to make it pass; fix the code, or stop and report.
3. New tests for every new rule: isolation (other business / other branch = not found), permissions (new-name-only role and old-name role),
   version conflict 409, read-only support session refused, audit + event in one transaction, soft delete where the table has `deleted_at`.
4. Schema: additive migrations only; `prisma migrate diff --exit-code` empty in CI; every model `/// @app <id>`; manifests, MODEL-OWNERS,
   BRANCH_LABEL_ONLY updated; `npm run gen:permissions` after any manifest edit.
5. Security and wording: no secrets, `.env`, keys or `test-accounts.csv` committed; keys never leave the server; public texts never say
   "verified" and never name the technology company or show PAN.
6. CI must be green: `prisma validate`, `migrate diff`, `npm run check` (lint, typecheck, boundaries, manifests, all tests), `npm run build`.

## 4. How every reply ends (the owner reads only this)
Short, plain words, numbered, one thing at a time:
1. **Done:** what now works, in owner language (2 to 6 lines). PR numbers, test count.
2. **Progress:** Phase N x%, whole project y%.
3. **Your step:** usually "close the server windows; in the VS Code terminal run `.\scripts\ops\RUN-UPDATE.cmd`; send me a screenshot".
   If a screen changed, a short hand test after that (open this page, click this, expect that). The owner signs in with a **test account**
   from `test-accounts.csv` (e.g. `owner.agency.business@sheetal.test`); never put the password in chat.
4. **Next:** "Say **next** for Phase N+1" (or "to continue Phase N").
Attach any file you mention (SendUserFile), never just its name.

## 5. If the owner sends a screenshot or an error
Read it, fix the cause, and give the one next step. Common: Prisma can't rebuild on Windows = a server still runs
(`Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force`, then RUN-UPDATE again). `git pull` says "no tracking
information" = use `git pull origin <branch>`. A page shows sample data (Import/Export, 212 reviews) = not signed in with a test account.

## 6. Working speed (learned in Phase 2)
- One app (or one tight group of apps) per PR; wait for CI (~7 min) in the background while you read the next app. Merge only on green.
- Update `handovers/CONTINUE-phase-2.md` in the same PR as the work when you can (a separate note-only PR costs another CI run).
- The owner wants speed; never trade checks for it. Be honest early when a plan is too optimistic (say it before starting, not after).
- If the chat gets long, say so and offer a fresh chat: everything needed is in `handovers/` and `handovers/MASTER/`.
