// Staff permissions and business permissions never meet (QA, P1-BE-2 fix 4).
// Why: the old name "roles.manage" exists in both worlds, so through the alias layer a business role holding it would also
// answer true for the staff permission "platform.role.manage". That is safe only while a business role list is never checked
// for a staff permission, and a staff check never reads a business role. These tests hold that line until the alias layer
// is removed (end of Phase 1, ACCESS.md 6.3 point 4) and the request context separates the two lists by type (P1-BE-3).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_ROLES, hasPerm, roleTemplatesFor, BUSINESS_TYPES } from "../src/domain/permissions.js";

const root = join(import.meta.dirname, "..", "..");
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === "dist" ? [] : tsFiles(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe("staff and business permissions stay apart", () => {
  it("every hasPerm in the admin API reads a staff role from PLATFORM_ROLES", () => {
    const bad: string[] = [];
    for (const f of tsFiles(join(root, "admin", "backend", "src"))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/hasPerm\(([^,]+),/g)) {
          if (!m[1]!.trim().startsWith("PLATFORM_ROLES[")) bad.push(`${f.slice(root.length + 1)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("no business or website code asks for a staff (platform.*) permission", () => {
    const bad: string[] = [];
    for (const dir of [join(root, "business", "backend", "src"), join(root, "website", "backend", "src")]) {
      for (const f of tsFiles(dir)) {
        readFileSync(f, "utf8").split("\n").forEach((line, i) => {
          if (/["'`]platform\.[a-z_]+\.[a-z_]+/.test(line)) bad.push(`${f.slice(root.length + 1)}:${i + 1}  ${line.trim()}`);
        });
      }
    }
    expect(bad).toEqual([]);
  });

  it("no business role template holds a staff permission by its own name", () => {
    for (const type of BUSINESS_TYPES) {
      for (const r of roleTemplatesFor(type)) expect(r.perms.filter((p) => p.startsWith("platform."))).toEqual([]);
    }
  });

  it("the known overlap is the only one, and it is why the lists must stay apart", () => {
    // Until stage 1.5 a business role with the old "roles.manage" answered true for the staff name through the alias layer. The layer is gone: it gives nothing.
    expect(hasPerm(["roles.manage"], "platform.role.manage")).toBe(false);
    // Staff roles without it do not get it.
    expect(hasPerm(PLATFORM_ROLES.support!, "platform.role.manage")).toBe(false);
  });
});
