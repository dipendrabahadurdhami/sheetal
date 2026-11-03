# Testing everything on this computer

Everything runs locally. Nothing is online yet: launch comes later, after the setup and checks below.

## Start it

Open four terminals in `C:\Users\USER\Desktop\sheetal` and run one command in each:

| Terminal | Command | What it is |
|---|---|---|
| 1 | `npm run db:local` | The database (PostgreSQL on port 5433). Keep it running. |
| 2 | `npm run dev:api` | The three APIs: website 4000, business 4001, admin 4002. |
| 3 | `npm run dev` | The three apps on http://localhost:5173 (`/`, `/business`, `/admin`). |
| 4 | `npm run dev:mail` | Sheetal's own mail server: business email, and system emails (sign-up, password reset, invitations, invoices). |

Then open http://localhost:5173.

## Accounts

| Who | Sign in at | Email |
|---|---|---|
| Super admin (Sheetal Admin) | http://localhost:5173/admin | admin@sheetalproperty.com |
| Sheetal Property agency (owner) | http://localhost:5173/business | shetalrealestate@gmail.com |

Passwords are the ones you set; change them before launch.

## Emails on this computer

System emails (confirm email, set a new password, team invitations, invoices, reminders) are **saved, not sent**
while testing: in `mail-server/mail-outbox` as `.eml` files, and in **Admin → System status → System emails**,
where each one can be opened and its link clicked. Keep terminal 4 running for this.

## Set up from the admin panel (super admin)

1. **Billing → Settings**: bank name, account name and number (for bank transfers); VAT, grace days and reminders if different.
2. **Billing → Settings → Payment methods**: eSewa, Khalti and Fonepay keys when you have merchant accounts
   (see `docs/payments.md`). Until then, eSewa's public test merchant works here on this computer.
3. **Setup → AI (Claude)**: the Anthropic API key, model (claude-opus-5-5) and credits per plan.
4. **Setup → Meta**: the app secret and a verify token; give Meta the webhook URL shown there.
   (Meta can only reach the webhook once the site is online.)
5. **Content**: blog posts (13 imported), jobs, the requirement fee.
6. **Plans**: prices and limits if you want to change them.

## Check from the business panel

- **Listings**: add one with the wizard, see it "In review", approve it in admin **Moderation**, see it on the website.
- **Inbox**: send an enquiry from a property page on the website; reply from the Inbox.
- **Plan and billing**: start an eSewa test payment (it opens eSewa's test page).
- **Front desk / Bookings / POS** (Pro includes hotel tools): add rooms, book, check in, add a restaurant bill to the room, take payment, check out.
- **Projects / Investors**: need a project or investment listing first.
- **Channels and other sites**: connect WhatsApp (needs Meta) and calendar links from Booking.com / Airbnb.
- **Analytics**: fills up as you browse the website (bots are left out).

## Before launch (not done yet, on purpose)

- A server, the domain and HTTPS for the website, `/business`, `/admin` and the APIs; the mail server's DNS (MX, SPF, DKIM, DMARC).
- Production `.env` with a new `SECRETS_KEY`, database password and passwords for both accounts.
- Backups of the database and `MEDIA_DIR` (photos), and monitoring.
- Updates for known issues in development tools: vite, vitest (test runner) and Prisma's config package
  (`npm audit` lists them; none of them are in what visitors use, but update before launch).
- Redis for the cache if more than one server is used.
- Photos to object storage and resized WebP sizes.
- Real merchant tests for Khalti and Fonepay (needs their accounts).
