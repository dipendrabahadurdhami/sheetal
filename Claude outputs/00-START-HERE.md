# Sheetal team: how to run the specialist chats

This chat (the one where you got this file) is the **Lead**. The specialist chats are the team. The Lead plans each
task, writes its prompt, picks only the code files it needs, and reviews and applies what comes back.

## The team

| Chat name to create | Specialist | Starts | Stays for |
| --- | --- | --- | --- |
| Sheetal 1 - Database | Database (Prisma, migrations, data safety) | Now | Whole project |
| Sheetal 2 - Backend | Backend (APIs, domain logic, tests) | After DB-1 is applied | Whole project |
| Sheetal 3 - Frontend | Frontend (React screens, shared UI kit) | Phase 1, after the Architect's design | Whole project |
| Sheetal 4 - Architect | Architect (structure, base classes, access model) | Now (design only) | Whole project |
| Sheetal 5 - QA and Audit | Reviews every output before it is applied | Now | Whole project |
| Sheetal 6 - DevOps | Git, GitHub, CI, backups, deploy | Now (first!) | Whole project |

More specialists join later when their phase comes: **Payments** (Phase 3), **Website/SEO** (Phase 5),
**AI and Notifications** (Phase 6), **Content/Legal** (Phase 2). The Lead will tell you when to open each one.

When a chat gets long, it writes a `HANDOVER-<TASK-ID>.md`. Start a fresh chat with the same name plus "(2)", paste
`TEAM-RULES.md`, the handover and the next prompt, and carry on.

## Phase 0: what to do, in order

You received five zips. Each has `PROMPT.md` (paste it as the first message), `TEAM-RULES.md` and the code files that
chat needs. Attach the whole zip to the chat.

**Step 1: start these at the same time**

| Chat | Zip | Paste |
| --- | --- | --- |
| Sheetal 6 - DevOps | `P0-chat6-devops.zip` | its PROMPT.md |
| Sheetal 1 - Database | `P0-chat1-database.zip` | its PROMPT.md |
| Sheetal 4 - Architect | `P1-chat4-architect.zip` | its PROMPT.md |
| Sheetal 5 - QA and Audit | `P0-chat5-qa.zip` | its PROMPT.md (it replies "QA ready") |

**Step 2: save your work first.** Run DevOps's "safety commit" commands as soon as it gives them, **before**
applying anything else.

**Step 3: database repair.** When Database returns `OUT-P0-DB-1.zip`:
1. Send it to QA (Sheetal 5) and to me (the Lead).
2. When QA approves, I write the files into your folder (or you unzip it in the repo root), then you run the
   commands in its `CHANGES-P0-DB-1.md`.
3. Then run: `npm test 2>&1 | Out-File -Encoding utf8 test-output.txt`

**Step 4: fix the tests.** Open **Sheetal 2 - Backend** with `P0-chat2-backend.zip` + `test-output.txt` + its
PROMPT.md. Its `OUT-P0-BE-1.zip` goes to QA and to me the same way. Then run `npm run check`.

**Step 5: finish Phase 0.** When `npm run check` is fully green: paste the end of its output to QA for sign-off,
then run DevOps's merge steps (merge to `main`, tag `phase-0-done`, push).

**Step 6:** send me the Architect's `OUT-P1-ARCH-1.zip` and QA's Phase 0 sign-off. I then prepare the Phase 1
prompts and zips for Database, Backend and Frontend.

## Rules for you as the owner

- Every OUT zip goes to **QA first**, then to me. Nothing is applied without both.
- Never apply two zips that change the same file at once; I'll tell you the order.
- If a chat asks for a file, copy it from your folder (same path) or ask me and I'll prepare it.
- Run a backup before every database change: `npm run backup -- --no-photos`.
