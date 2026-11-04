// `npm run doctor`: checks this computer is ready to run the platform, and says how to fix what isn't.
// Read-only: it never changes files or data.
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const results = [];
const ok = (what, detail = "") => results.push(["ok", what, detail]);
const warn = (what, fix) => results.push(["warn", what, fix]);
const bad = (what, fix) => results.push(["fail", what, fix]);

// Node.js
const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) ok(`Node.js ${process.versions.node}`); else bad(`Node.js ${process.versions.node} is too old`, "Install Node.js 20 or newer from nodejs.org.");

// Installed packages
if (existsSync(join(root, "node_modules", "@prisma", "client"))) ok("Packages installed"); else bad("Packages not installed", "Run: npm install");

// Settings files
const env = readEnv(join(root, "backend-core", ".env"));
if (!existsSync(join(root, "backend-core", ".env"))) bad("backend-core/.env is missing", "Copy backend-core/.env.example to backend-core/.env and fill it in.");
else {
  ok("backend-core/.env found");
  for (const k of ["DATABASE_URL", "SITE_URL", "API_URL"]) if (!env[k]) bad(`${k} is empty in backend-core/.env`, "See backend-core/.env.example.");
  if (!env.SECRETS_KEY) warn("SECRETS_KEY is empty", "Fine on this computer; required in production (32+ random characters).");
  if (!env.MEDIA_DIR) warn("MEDIA_DIR is empty", "Photo uploads won't work until it points at the photos folder.");
  else if (!existsSync(env.MEDIA_DIR)) bad(`MEDIA_DIR folder not found: ${env.MEDIA_DIR}`, "Fix the path in backend-core/.env.");
  else ok("Photo folder (MEDIA_DIR) found");
}
for (const [file, what] of [["website/frontend/.env.local", "website"], ["business/frontend/.env.local", "business panel"], ["admin/frontend/.env.local", "admin panel"]]) {
  if (!existsSync(join(root, file))) warn(`${file} is missing`, `Without it the ${what} runs on sample data only. Copy the .env.example next to it.`);
}

// Database and running servers
const portOpen = (port) => new Promise((done) => { const s = createConnection({ port, host: "127.0.0.1" }); s.setTimeout(800); s.on("connect", () => { s.end(); done(true); }); s.on("error", () => done(false)); s.on("timeout", () => { s.destroy(); done(false); }); });
const dbPort = Number((env.DATABASE_URL || "").match(/:(\d+)\//)?.[1] || 5433);
if (await portOpen(dbPort)) ok(`Database answering on port ${dbPort}`); else warn(`Database not running on port ${dbPort}`, "Start it: npm run db:local");
const running = [];
for (const [port, name] of [[4000, "website API"], [4001, "business API"], [4002, "admin API"], [5173, "website and panels"], [2525, "mail server"]]) if (await portOpen(port)) running.push(`${name} :${port}`);
if (running.length) ok("Running now", running.join(", ")); else warn("Nothing else is running", "Start: npm run dev:api, npm run dev, npm run dev:mail");

// Git
if (existsSync(join(root, ".git"))) ok("Git repository found"); else warn("Not a git repository", "Clone it from GitHub to keep history and backups.");

const mark = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };
console.log("\nSheetal Property platform — doctor\n");
for (const [level, what, detail] of results) console.log(`[${mark[level]}] ${what}${detail ? `\n         ${detail}` : ""}`);
const fails = results.filter((r) => r[0] === "fail").length;
console.log(fails ? `\n${fails} problem(s) to fix before running.\n` : "\nReady.\n");
process.exit(fails ? 1 : 0);

function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1")]; }));
}
