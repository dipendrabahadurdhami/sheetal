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

There are three parts to keep safe. Git holds the code; the other two are backed up with one command.

| What | Where it is | Backup |
|---|---|---|
| Code (and every saved version) | this folder | private GitHub: https://github.com/dipendrabahadurdhami/sheetal |
| Database (listings, users, bookings, everything typed in) | `backend-core/.pgdata` | `npm run backup`: `OneDrive\Sheetal-Backups\database`, one dated folder each (newest 30 kept) |
| Photos and private documents | `C:\Users\USER\Desktop\sheetal-laravel\ROOT\public\images` (6.5 GB) | `npm run backup`: copied to `C:\Users\USER\Sheetal-Backups\photos` (only new or changed files after the first time) |

**Save the code to GitHub** after committing changes:

```
git push
```

**Back up the database and photos** (the database must be running, terminal 1):

```
npm run backup
```

Database only (quick): `npm run backup -- --no-photos`. Do it at least once a week, and before big changes.

The photos copy is on the same disk as the original, so it protects against mistakes but not against losing the
computer. For that, add `PHOTOS_BACKUP_DIR=E:\Sheetal-photos` (your USB drive's letter) to `backend-core/.env` and run
`npm run backup` with the drive plugged in. OneDrive's free 5 GB is too small for the photos.

**Put a database backup back** (replaces all current data; only when something went wrong):

```
npm run restore
npm run restore -- 2026-11-04_1013 --yes
```

The first command lists the backups; the second restores the one you name. Tested: a restore gives back every row.

**On a new computer:** install Node.js and Git, then `git clone https://github.com/dipendrabahadurdhami/sheetal.git`,
`npm install`, create `backend-core/.env` from `backend-core/.env.example` (your own passwords and keys), start the
database (`npm run db:local`), run `npx prisma migrate deploy` in `backend-core`, copy `OneDrive\Sheetal-Backups`
across and run `npm run restore -- <name> --yes`, then copy the photos back to MEDIA_DIR.
