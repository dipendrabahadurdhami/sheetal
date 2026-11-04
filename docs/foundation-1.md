# Foundation 1 (pre-launch phase, sprint 01)

What changed, and how to run it. Applied with `node foundation-1/apply.mjs` on 4 November 2026.

## 1. Photos: resizing and object storage

Every upload (business listings, website posts, blog pictures, business logos, payment QRs) now goes through
`backend-core/src/lib/photos.ts`:

| Size | Where it shows | Long side | Format |
|---|---|---|---|
| `main` | Photo page, gallery | up to 1920 px | WebP, quality 82 |
| `thumbnail` | Cards, lists, search, map | up to 800 px | WebP, quality 80, lightly sharpened |
| `original` | Never served | as uploaded | as uploaded |

- Photos are turned upright (phone rotation), converted to sRGB, and their hidden data (GPS position, camera) is removed.
- Nothing is ever enlarged; logos keep their transparency.
- The thumbnail is 800 px so cards stay sharp on phones and 2× screens. A typical phone photo of 4–8 MB becomes about
  250–450 KB (main) and 50–90 KB (thumbnail).
- Uploads can now be up to 20 MB (they are made smaller here).

**Photos already on the server** (the 16,916 imported ones and anything uploaded before): run

```
npm run photos:resize -- --dry-run     # counts what it would do, changes nothing
npm run photos:resize                  # does it; safe to stop with Ctrl+C and run again
```

It keeps each untouched photo in `original/` first, re-makes every thumbnail at 800 px from it, and makes `main`
smaller only when it is bigger than 1920 px or heavier than 700 KB. Names and formats stay the same (a `.jpg` stays
JPEG), so nothing in the database changes. Progress is kept in `MEDIA_DIR/.resized/`. Keeping originals needs about
as much free disk as the photos folder has now; `--no-original` skips that (not undoable).

**Object storage** (for the online server, optional now): add to `backend-core/.env`

```
S3_BUCKET=sheetal-photos
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
MEDIA_URL=https://photos.sheetalproperty.com
```

New uploads then go to the bucket as well; `npm run photos:resize -- --upload --force` copies the existing ones.

## 2. Admin catalog drives the listing forms

Admin → Listing setup saves on the server (`/v1/admin/catalog`, stored as the `catalog` app setting). The business
panel loads it (`GET /v1/catalog`) over `shared/src/data/catalog.js`, so the wizard, filters and labels follow, and
the business API checks new listings' kinds against "Who can list what". The website shows what listings were saved
with. "Reset" on a list goes back to the built-in one.

## 3. Business settings on the server

Settings → Payments, Notifications, Listing defaults, Documents and the receipt texts are saved in
`tenants.settings` (new column, migration `20261104100000_tenant_settings`), the same on every device. The Khalti key
is sealed with `SECRETS_KEY` and only shown as `••••••••`. Payment QR images upload to the server.

## 4. Listing check-ups on the server

Check-up settings and every check-up action (all correct, extend, sold, expired, removed, skipped) are saved; the next
check date follows the business's "All correct keeps it live for" setting; the team history comes from the audit log.

## 5. Import and export on the server

Listings and leads import to the server (listings as drafts in the picked branch, within the plan's room); listings,
leads, rooms, bookings and the team export from it. Other kinds still work in the browser until their pages are built.

## Removed from "Preview"

`/business/data`, `/business/settings/payments`, `/business/settings/notifications`, `/business/settings/listings`,
`/business/settings/documents`, `/admin/catalog`.

## Not in this step

- "Hide it until checked" (check-up setting) is saved but the website doesn't hide overdue listings yet.
- Payment settings are saved; using the business's own gateways at checkout comes with the Money sprint.
- Accepting AI title fixes on a check-up card still goes through Edit (it needs Sheetal's review).

## Undo

`node foundation-1/apply.mjs --undo` puts back every file as it was before (from `.foundation-1-backup/`). The
database column stays; it is harmless.
