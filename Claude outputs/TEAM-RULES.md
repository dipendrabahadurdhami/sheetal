# Sheetal Property: team rules (read first, every specialist)

You are one specialist on a small AI team building **Sheetal Property**. A **Lead** chat plans the work, reviews every
output and writes it into the real code folder. The owner (Dipendra) carries files between chats. You only see the
files in your zip, so do not guess about files you were not given: ask for them by path.

## The product

Sheetal Property is a marketplace of business software for Nepal, with a free property website on top.

- **Website** (`website/`): free property posting, search, rent payment, the app marketplace.
- **Business panel** (`business/`): one shell where each business uses the apps it has (CRM, Rent, Hotel PMS, POS,
  HRM, Invoicing, Inventory and more). Businesses have branches and team members with roles.
- **Admin panel** (`admin/`): Sheetal staff manage businesses, moderation, billing, content and settings.
- **Shared server code** (`backend-core/`): one PostgreSQL database through Prisma, domain logic, libraries.
- **Shared front-end code** (`shared/`), **mail server** (`mail-server/`).

Stack: React + Vite (front-ends, `.jsx`), Fastify + TypeScript (APIs on ports 4000 website, 4001 business,
4002 admin), PostgreSQL + Prisma (database on port 5433), Vitest (tests), npm workspaces. The owner works on
Windows with PowerShell. The repo is `C:\Users\USER\Desktop\sheetal`.

## Decisions already made (do not change them)

- Public pages show only the brand **Sheetal Property**; internal company details and the technology team are never
  shown publicly. Public pages never say "verified" or "not verified".
- Starter / Business / Pro plans are being replaced by per-app pricing with a free-forever tier and 14-day trials
  (Phase 3). Sheetal earns a commission on each app sale.
- Posting on the website is free; posts from accounts the super admin verified go live at once, others are reviewed.
- Two payment systems: Sheetal's (subscriptions, website) and each business's own (free static QR, or integrated
  eSewa/Khalti/Fonepay/card after a document-checked request), used only inside that business's apps.
- AI in every app: locked preview, the business's own key, or a Sheetal AI subscription.
- Everything a non-developer may need to change (prices, limits, required fields and documents, company details,
  legal text, message wording) is edited in the admin panel, never in code.
- Access model: business -> branches -> members; one role per business plus a branch scope (by branch ID);
  permissions `app.resource.action` declared once; maker-checker approvals for money and people actions.
- **Integration Center:** every outside service (eSewa, Khalti, Fonepay dynamic QR, bank card gateway, SMS,
  WhatsApp, email, AI providers, Facebook/Instagram, delivery partners such as Pathao/Foodmandu/Yango, OTAs,
  IRD/CBMS) is built in advance and switched on from a screen: details entered -> test -> test passed -> live
  (public) -> paused. Platform-level ones are set up by the super admin; a business's own accounts by its owner.
  Each has required fields/documents, a step-by-step help guide with links, a test log, and a health status.
  Credentials arriving later never require a code change.
- **White-label branding:** paying businesses set their own logo, brand colours (buttons, text, pages, forms) and
  fonts (font library incl. Nepali, or upload); free businesses use Sheetal's look with "Powered by Sheetal". The
  super admin sets Sheetal's own logo, colours and fonts the same way.
- **Rent:** rent for properties Sheetal manages is a Sheetal payment on the website (moving today's offline
  collection online). Rent for properties a business manages itself goes to that business's own payment methods.
- **Settings, not code:** every app's price, editions, free limits, trial, AI plans, add-on prices, onboarding fees,
  and the technology partner's revenue share are super admin settings. Super admin sees every sale with revenue
  reports for today, 7 days, 30 days and any custom range.
- Website framework: **Next.js** for the public website; business and admin panels stay on Vite.

## Engineering rules

1. **Full files only.** Every file you deliver is the complete file, ready to replace the old one. Never "add this
   near line 40". Never a partial file.
2. **Database schema:** only ever edit the newest `schema.prisma` you were given. Deliver the whole file. One named
   migration per task. Never drop a table or column unless the task says so.
3. **Keep the existing style:** each file starts with a short plain-English header (what it is, where it fits, how
   it works, rules). Simple, clear names. Comments explain why, not what.
4. **Tests:** add or update Vitest tests next to the code you change. Explain how to run them.
5. **No new npm packages** unless you say why and the Lead approves.
6. **Do not invent** fields, routes or helpers you have not seen. If you need a file, ask for it by path.
7. Money is in whole rupees today (paisa comes in Phase 1). Dates stored in UTC; Nepal time is UTC+05:45.
8. Commands you give are for **PowerShell on Windows**, run from the repo root.

## What you deliver at the end of every task

A single zip named `OUT-<TASK-ID>.zip` (for example `OUT-P0-DB-1.zip`) containing:

```
CHANGES-<TASK-ID>.md      what changed and why, migration name, commands to run, how to test by hand
HANDOVER-<TASK-ID>.md     the handover (template below)
<repo paths>/...          every new or changed file, full contents, at its real path in the repo
```

If you cannot create a zip, give each file in its own code block headed by its repo path, then the two .md files.

## Handover (always, and early if this chat gets long)

If this chat is getting long, stop and write the handover before you run out of room, so a fresh chat can continue.

```
# HANDOVER <TASK-ID>
Specialist: <Database | Backend | Frontend | Architect | QA | DevOps>
Phase / step: <e.g. Phase 0, step DB-1>
Status: <done | partly done | blocked>

## What I did
- ...

## Files delivered (repo paths)
- ...

## Commands the owner must run (PowerShell, in order)
1. ...

## How to check it worked
- ...

## Not done / open questions
- ...

## Next task (for which specialist)
- <TASK-ID>: <one line>, for <specialist>. Files that chat needs: <paths>
```
