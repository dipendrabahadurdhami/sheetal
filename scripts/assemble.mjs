// Puts the three builds into one folder for hosting:
//   dist/            ← website
//   dist/admin/      ← admin
//   dist/business/   ← business
import { cpSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const out = root + "dist";
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
cpSync(root + "website/frontend/dist", out, { recursive: true });
cpSync(root + "admin/frontend/dist", out + "/admin", { recursive: true });
cpSync(root + "business/frontend/dist", out + "/business", { recursive: true });
console.log("Built: dist/ (website), dist/admin/, dist/business/");
