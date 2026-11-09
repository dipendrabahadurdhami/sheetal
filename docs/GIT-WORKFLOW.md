# Git workflow: how we save and merge work

Short and simple. These rules protect the code: nothing is lost, and nothing broken reaches `main`.
Commands are for PowerShell, run from the repo root (`C:\Users\USER\Desktop\sheetal`).

## The rules

1. **`main` is always green.** Everything on `main` passes `npm run check`. Nobody works directly on `main`.
2. **One branch per task.** Name: `phase-<n>/<task-id>-<short-name>`
   - `phase-0/P0-DB-1-database-repair`
   - `phase-0/P0-BE-1-fix-tests`
   - `phase-1/P1-DB-2-paisa-money`
3. **Commit message format:** `<TASK-ID>: <what changed>`, in plain words, present tense.
   - `P0-DB-1: repair the rentals migration`
   - `P0-BE-1: fix payout tests that used the wrong date`
   - Work in progress that must be saved: `P0-BE-1: WIP payouts tests (still failing)`
   - Work not tied to a task: `docs: update the git workflow`
4. **Merge only when both are true:** `npm run check` passes (on your computer and the green tick on GitHub),
   and QA has approved the task.
5. **Tag every finished phase:** `phase-0-done`, `phase-1-done`, and so on. A tag is a bookmark: we can always come back.
6. **Small and often.** Commit after each working step. Push at least at the end of every work session.

## Daily routine (one task)

```powershell
# 1. Start from the latest main
git checkout main
git pull

# 2. Make the task branch
git checkout -b phase-1/P1-DB-2-paisa-money

# 3. Work. After each step:
git status                                   # look at what changed
git add <folder or file>
git commit -m "P1-DB-2: add paisa columns to payments"

# 4. Before you push, and always before asking for QA:
npm run check

# 5. Save to GitHub (the first push of a branch needs -u)
git push -u origin phase-1/P1-DB-2-paisa-money
```

## Merging a task

1. Push the branch. On GitHub, open a **Pull request** into `main`, titled like the commit (`P1-DB-2: paisa money`).
2. Wait for the **check** run to turn green. If it is red, fix on the same branch and push again.
3. QA approves. Then the Lead (or you, when the Lead says so) presses **Squash and merge**. Confirm on GitHub that the pull request shows **Merged** before deleting the branch.
   One task = one clean commit on `main`.
4. Update your computer and clean up:

```powershell
git checkout main
git pull
git branch -D phase-1/P1-DB-2-paisa-money                    # delete the local branch (-D: squashed branches look unmerged to git)
git push origin --delete phase-1/P1-DB-2-paisa-money         # delete the GitHub branch
```

## Finishing a phase

```powershell
git checkout main
git pull
npm run check                                                # must be green
git tag -a phase-0-done -m "Phase 0 finished: repaired database, tests green"
git push origin phase-0-done
```

Go back to a tagged state to look (read-only): `git checkout phase-0-done`, then `git checkout main` to return.

## What is never committed

`.env` and any `.env.*` file (except `.env.example`), `test-accounts.csv`, `backend-core/.pgdata`, any `*.zip`,
keys (`*.pem`, `*.key`), database exports. The `.gitignore` already blocks these. Before every commit, `git status`
must not list any of them. If one appears, **do not commit**: tell the Lead.
If a secret was ever pushed, treat it as leaked: change the password or key first, ask the Lead how to clean the history after.

## Before risky work

Run `npm run backup` (database and photos). Git protects code only; the database is not in git.

## Mistakes and how to undo them

| Situation | Command |
|---|---|
| Changed a file and want the old version back (not committed) | `git restore <file>` |
| Staged a file by mistake | `git restore --staged <file>` |
| Last commit has the wrong message, not pushed yet | `git commit --amend -m "P0-DB-1: new message"` |
| Last commit was a mistake, not pushed yet (keep the files) | `git reset --soft HEAD~1` |
| Committed on `main` by mistake, not pushed yet | `git branch phase-x/<task-id>-<name>`, then `git reset --hard origin/main`, then `git checkout phase-x/<task-id>-<name>` |
| Want to see what is going on | `git status`, `git log --oneline -10`, `git branch -a` |

Never use `git push --force` on `main`. If you think you need it, ask the Lead.

## One-time GitHub settings (Settings, Branches, Add rule for `main`)

- Require a pull request before merging.
- Require status checks to pass: choose **check**.
- Do not allow force pushes or deletion.

(Some free private repositories do not offer these settings. Then the rules above work by discipline, and
the workflow still runs and shows the red or green mark.)

## Where a task branch starts

- A task starts from `main`, or from the branch of the task it depends on.
- Phase 0 only: `P0-DB-1` starts from `wip/before-phase-0`; `P0-BE-1` starts from the `P0-DB-1` branch (its tests need
  the repaired database). Merge `P0-DB-1` first, then `P0-BE-1`. If `main` does not exist yet, create it from the last
  merged branch only after both are merged.
- The Lead names the starting branch in every task.
