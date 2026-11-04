// `npm run help`: every command of the project, grouped, with one line on what it does and when to use it.
// Keep this list in step with "scripts" in package.json; `npm run help -- --check` fails if one is missing here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GROUPS = [
  ["Run it on this computer (four terminals, in this order)", [
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
    ["typecheck", "TypeScript checks for the shared code and every server."],
    ["test", "All automated tests (shared, core, website, business, admin, mail). They use their own temporary database."],
    ["test:watch", "Re-runs the shared front-end tests on every save."],
    ["doctor", "Checks this computer is ready: Node version, settings files, database, ports, photo folder."],
    ["check:comments", "Proves a documentation change touched comments only (compares the code before and after)."],
  ]],
  ["Database", [
    ["db:migrate", "Applies new database migrations (after pulling changes that touch backend-core/prisma)."],
    ["db:seed", "Adds the starting data: plans, the super admin and the Sheetal Property business (first setup)."],
    ["backup", "Exports the database to OneDrive\\Sheetal-Backups and copies new photos. Add -- --no-photos for the database only."],
    ["restore", "Lists database backups; `npm run restore -- <name> --yes` puts one back (replaces all data)."],
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
