// The guard of stage 1.5: no old permission name is left where a permission is checked (ACCESS.md section 6.3, step 4).
// How it works: every source file (not tests, not generated files, not the role rewrite script and the legacy table it reads) is run through the same
// tool that rewrote the call sites (scripts/perm-names.mjs). (1) The tool must find nothing left to rewrite in any permission-check shape.
// (2) A string that merely LOOKS like an old permission (an audit action such as "settings.platform", a translation key such as t("pos.restaurant"),
// a comment) is allowed only in the files listed below with that exact count, so a new one is noticed and looked at by a person.
// (3) Nothing imports the alias layer, and the resolvers do not read the legacy tables.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSkipped, kindOf, leftIn, rewrite } from "../../../scripts/perm-names.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const files = execSync("git ls-files '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs'", { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && !isSkipped(f) && existsSync(join(root, f)));
const read = (f) => readFileSync(join(root, f), "utf8");

// Strings that look like an old permission name but are something else. file -> how many.
const LOOK_ALIKES = {
  "admin/backend/src/modules/platform.ts": 1,            // audit action "settings.platform"
  "admin/backend/src/modules/verification.ts": 1,        // a comment
  "admin/frontend/src/pages/AdminGrowth.jsx": 1,         // t("content.publish")
  "admin/frontend/src/pages/AdminOps.jsx": 1,            // t("content.publish")
  "apps/pos/backend/pos.service.ts": 1,                  // audit action "pos.void" (moved from modules/pos in P2-W4)
  "business/backend/src/modules/billing/routes.ts": 1,   // a comment
  "backend-core/src/domain/permissions.ts": 1,           // a comment saying the old names ended
  "business/backend/src/modules/verification/routes.ts": 1, // a comment
  "shared/src/core/rbac.js": 1,                          // a comment saying the old names ended
  "shared/src/i18n/en-admin.js": 1,                      // translation text
  "shared/src/i18n/en-ops.js": 3,                        // translation text
};

describe("no old permission name is checked anywhere", () => {
  it("looks at the real source tree", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain("business/frontend/src/pages/BusinessApp.jsx");
    expect(files).toContain("shared/src/core/rbac.js");
    expect(files).toContain("backend-core/src/domain/permissions.ts");
  });

  it("the rewrite tool finds no permission check left to rewrite, with either table", () => {
    const bad = [];
    for (const f of files) {
      const text = read(f);
      for (const kind of kindOf(f) ? [kindOf(f)] : ["business", "platform"]) {
        const n = rewrite(text, kind).changed;
        if (n) bad.push(`${f}: ${n} check(s) still name an old ${kind} permission`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("strings that only look like an old name are exactly the known ones", () => {
    const found = {};
    for (const f of files) { const n = leftIn(read(f), kindOf(f)).length; if (n) found[f] = n; }
    expect(found).toEqual(LOOK_ALIKES);
  });

  it("a staff notice names a staff permission of the manifest, never an old name", () => {
    const bad = [];
    for (const f of files) for (const m of read(f).matchAll(/notifyStaff\([^,]*,\s*"([^"]+)"/g)) if (!m[1].split("+").every((p) => p.startsWith("platform."))) bad.push(`${f}: ${m[1]}`);
    expect(bad).toEqual([]);
  });

  it("the alias layer is gone and nothing at run time reads the legacy tables", () => {
    expect(existsSync(join(root, "platform/src/tenancy/aliases.ts"))).toBe(false);
    const readers = files.filter((f) => /LEGACY_(ALIASES|PLATFORM_ALIASES|TEMPLATES|PLATFORM_ROLES|BUSINESS_GROUPS|PLATFORM_GROUPS)/.test(read(f)));
    expect(readers).toEqual([]);
    for (const f of files) expect(read(f).includes("tenancy/aliases"), f).toBe(false);
  });
});
