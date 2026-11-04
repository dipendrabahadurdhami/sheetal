# Sheetal Property: start here

Everything is in this folder: `C:\Users\USER\Desktop\sheetal`. It runs on this computer only (not launched yet).

| Part | Folder | Opens at |
|---|---|---|
| Public website | `website/` | http://localhost:5173 |
| Business panel | `business/` | http://localhost:5173/business |
| Super-admin panel | `admin/` | http://localhost:5173/admin |
| Shared server code and database | `backend-core/` | database on port 5433 |
| Sheetal's mail server | `mail-server/` | |
| Guides and the status report | `docs/` | |

## 1. Start it (every time)

Open **four** terminals (PowerShell or Windows Terminal) in `C:\Users\USER\Desktop\sheetal` and run one command in each.
Keep all four open while you use it.

| Terminal | Command | What it is |
|---|---|---|
| 1 | `npm run db:local` | The database. Start this first. |
| 2 | `npm run dev:api` | The three servers (website 4000, business 4001, admin 4002). |
| 3 | `npm run dev` | The website and both panels. |
| 4 | `npm run dev:mail` | The mail server: business email and system emails (saved, not sent, on this computer). |

Then open http://localhost:5173 in your browser. To stop, press `Ctrl + C` in each terminal.

If something says a port is "already in use", an old copy is still running: close all terminals (or restart the
computer) and start again.

## 2. Sign in

| Who | Where | Email |
|---|---|---|
| Super admin (Sheetal staff) | http://localhost:5173/admin | admin@sheetalproperty.com |
| Sheetal Property (business owner) | http://localhost:5173/business | shetalrealestate@gmail.com |

Passwords are the ones you set. Change any password that was shared in a chat before launch.

## 3. Check that everything works

**Automatic tests** (about 5 minutes; they use their own temporary database, so your data is never touched):

```
npm test
```

All 250 tests should pass (shared 37, core 32, website 55, business 84, admin 26, mail 16).

**By hand**, a quick walk-through:

1. Business panel: add a listing with the wizard; it shows "In review".
2. Admin: Moderation, approve it; it appears on the website.
3. Website: open the listing, send an enquiry; it arrives in the business Inbox (and the bell).
4. Business: Settings, Verification: add documents and send; Admin: Moderation, Business verification: verify.
5. Hotel business: add rooms, set prices in Calendar, make a booking, check in, add a restaurant bill, check out.
6. Admin: System status, System emails: open the emails that were "sent" (on this computer they are saved).

Pages marked **Preview** in the menu still show sample data; nothing on them is saved yet.

## 4. Where things stand

- `docs/Sheetal-Project-Status-Report.pdf` (and `.docx`): what is done, what is left, what to focus on next,
  integrations to set up, and the launch checklist.
- `docs/local-testing.md`: setting up keys (payments, AI, Meta) from the admin panel.
- `docs/mail-server.md`: putting the mail server online. `docs/payments.md`: merchant accounts needed.

## 5. Continue development

1. Open this folder (`C:\Users\USER\Desktop\sheetal`) in your code editor.
2. Read this file and `docs/Sheetal-Project-Status-Report.pdf`; section 7 lists what to build next.
3. The full history of changes is in git (`git log`), with a short note on each change.

## 6. Saved versions and backup

Every change is saved as a version with git (64 versions so far). See them with `git log --oneline`.

**Important:** there is no copy online yet. If this computer is lost, the work is lost. Back it up: copy the whole
folder to a USB drive or cloud storage now and then (`backend-core/.pgdata` holds the database; copy it while the database is stopped), or put it on a
private GitHub repository.
