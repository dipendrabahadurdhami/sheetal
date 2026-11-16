// `npm run help`: every command of the project, grouped, with one line on what it does and when to use it.
// Keep this list in step with "scripts" in package.json; `npm run help -- --check` fails if one is missing here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GROUPS = [
  ["Run it on this computer (four terminals, in this order)", [
    ["start", "Starts everything in one window: database, the three APIs, the website and panels, and the mail server."],
    ["db:local", "Starts the local PostgreSQL database on port 5433. Start this first and keep it open."],
    ["dev:api", "Starts the three APIs: website :4000, business :4001, admin :4002. Restarts on code changes."],
    ["dev", "Starts the website, business panel and admin panel on http://localhost:5173."],
    ["dev:mail", "Starts the mail server: business email and system emails (saved as files locally)."],
  ]],
  ["Run one part only", [
    ["dev:website", "Only the public website (vite)."],
    ["dev:business", "Only the business panel (vite)."],
    ["dev:admin", "Only the super-admin panel (vite)."],
    ["dev:api:website", "Only the website API."],
    ["dev:api:business", "Only the business API."],
    ["dev:api:admin", "Only the admin API."],
  ]],
  ["Check the code (before every commit)", [
    ["check", "Everything below in one go: lint, typecheck, then all tests. Must pass before merging."],
    ["lint", "ESLint over the whole repository: unused code, mistakes, style."],
    ["typecheck", "TypeScript checks for the shared code, the packages and every server (including platform and the apps)."],
    ["test", "All automated tests (shared, core, platform, apps, website, business, admin, mail). They use their own temporary database."],
    ["gen:permissions", "Writes the permission lists from the app manifests (both the server and screen copy). Add -- --check to only compare. Run it after you change an app.manifest.ts."],
    ["check:manifests", "Checks every app manifest is complete and consistent (permissions, menu, models) against the 8 rules of APP-MANIFEST section 9."],
    ["check:boundaries", "Checks who may import whom in platform, packages and apps (an app never imports another app; packages never import platform)."],
    ["check:schema", "Checks every database model is tagged with the app that owns it. Does nothing until the models are tagged."],
    ["check:money", "Checks every paisa column in the database schema is a BigInt (an Int is too small for money in paisa, a Float loses paisa)."],
    ["check:catalog", "Checks the marketplace catalog is safe to sell from: seed prices and limits agree with the app manifests. Add -- --db to check the catalog saved in the database too."],
    ["test:watch","Re-runs the shared front-end tests on every save."],
    ["doctor", "Checks this computer is ready: Node version, settings files, database, ports, photo folder."],
    ["check:comments", "Proves a documentation change touched comments only (compares the code before and after)."],
    ["qc", "Quick check while working: lint the apps and typecheck the shared code, without the tests."],
    ["dc", "Same as check (a short name for it)."],
  ]],
  ["Database", [
    ["db:migrate", "Applies new database migrations (after pulling changes that touch backend-core/prisma)."],
    ["db:seed", "Adds the starting data: plans, the super admin and the Sheetal Property business (first setup)."],
    ["backup", "Exports the database to OneDrive\\Sheetal-Backups and copies new photos. Add -- --no-photos for the database only."],
    ["restore", "Lists database backups; `npm run restore -- <name> --yes` puts one back (replaces all data)."],
    ["listings:tidy", "Fills empty listing fields from each title and description and writes a short description. Try -- --dry-run first."],
    ["billing:migrate", "Moves businesses from Starter / Business / Pro to app subscriptions, with proofs. Dry run by default; --apply, --restore, --csv=file (docs/p3-migration-howto.md)."],
    ["billing:mode", "Lists every business's billing mode (plans, shadow, apps) and what stands in its way; with -- --to=shadow|apps|plans --business=ID or --all it says what would change, and with --apply it writes. Moving to apps voids open plan invoices: backup first."],
    ["scratch", "A scratch copy of the database for trying risky steps: -- make (from the newest backup), -- run <command> (runs it against the copy, never the real data), -- drop."],
    ["promote:gift","Gives listings that were featured on the old website a free 30-day home-page boost (run once after the Promote update)."],
    ["accounts:test", "Makes test accounts on this computer (staff, every business type and plan with its team, website users) plus sample data, and saves the list to test-accounts.csv. Never on the live site."],
    ["listings:codes", "Gives every business without one its property code prefix (its initials, Everest Realty → ER) and changes its listing codes; old codes keep working. Try -- --dry-run first."],
    ["roles:new-names", "Moves every business role from the old permission names to the new ones. Without anything: shows what would change and writes nothing. With -- --apply: writes (take a backup first). With -- --restore: puts the old lists back."],
    ["integrations:migrate", "Copies today's connection settings (eSewa, Khalti, Fonepay, Google, WhatsApp, Cloudflare) into the Integration Center. Safe to run again; deletes nothing."],
    ["reviews:sample", "Adds sample website reviews (one answered, two low, one on a listing) to the test agency so Business → Reviews can be tried. Never on the live site."],
    ["payouts:sample", "Adds sample collected payments to a business so the Payouts pages can be tested. Try -- --help first."],
    ["photos:resize", "Makes every photo in MEDIA_DIR the new sizes (main 1920 px, thumbnail 800 px). Try -- --dry-run first."],
  ]],
  ["Build and release", [
    ["build", "Builds the website and both panels into dist/ (with the sitemap)."],
    ["preview", "Serves the built dist/ on http://localhost:4173 to check the production build."],
    ["sitemap", "Regenerates the website sitemap."],
  ]],
  ["Help", [
    ["help", "This list."],
  ]],
];

const root = fileURLToPath(new URL("..", import.meta.url));
const scripts = Object.keys(JSON.parse(readFileSync(`${root}package.json`, "utf8")).scripts);
const listed = new Set(GROUPS.flatMap(([, items]) => items.map(([name]) => name)));

if (process.argv.includes("--check")) {
  const missing = scripts.filter((s) => !listed.has(s));
  const gone = [...listed].filter((s) => !scripts.includes(s));
  if (missing.length || gone.length) {
    if (missing.length) console.error(`Not described in scripts/help.mjs: ${missing.join(", ")}`);
    if (gone.length) console.error(`Described but not in package.json: ${gone.join(", ")}`);
    process.exit(1);
  }
  console.log("Every command is described.");
  process.exit(0);
}

const bold = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
console.log(`\n${bold("Sheetal Property platform — developer commands")}   (run as: npm run <command>)\n`);
for (const [title, items] of GROUPS) {
  console.log(bold(title));
  for (const [name, what] of items) console.log(`  ${name.padEnd(18)} ${what}`);
  console.log("");
}
console.log("Start here: START-HERE.md · Developer guide: docs/DEVELOPER-GUIDE.md\n");
