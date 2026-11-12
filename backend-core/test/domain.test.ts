import { describe, expect, it } from "vitest";
import * as api from "../src/domain/permissions.js";
import { PLANS, priceFor } from "../src/domain/plans.js";
// The screens' copies. If one side changes without the other, these tests fail.
// @ts-expect-error -- the screens' files are plain JavaScript without types
import * as ui from "../../shared/src/core/rbac.js";
// @ts-expect-error -- the screens' files are plain JavaScript without types
import { PLANS as UI_PLANS } from "../../shared/src/demo/demo.js";
// @ts-expect-error -- the screens' files are plain JavaScript without types
import { priceFor as uiPriceFor } from "../../shared/src/core/plans.js";

describe("backend and screens agree", () => {
  it("permission groups: the screens group exactly the permissions the server offers a business", () => {
    const shown = (groups: { perms: string[] }[]) => groups.flatMap((g) => g.perms).sort();
    for (const type of api.BUSINESS_TYPES) expect(shown(ui.permsForType(type)), type).toEqual(shown([{ perms: api.businessPermsFor([type]) }]));
    expect(shown(ui.permsForTypes([...api.BUSINESS_TYPES]))).toEqual([...api.businessPermsFor(api.BUSINESS_TYPES)].sort());
    expect(shown(ui.PLATFORM_PERMS).every((p) => p.startsWith("platform."))).toBe(true);
    expect(shown(ui.BUSINESS_PERMS).some((p) => p.startsWith("platform."))).toBe(false);
  });
  it("role templates for every business type", () => {
    for (const type of api.BUSINESS_TYPES) {
      expect(api.roleTemplatesFor(type)).toEqual(ui.roleTemplatesFor(type).map((r: { key: string; perms: string[] }) => ({ key: r.key, perms: r.perms })));
    }
  });
  it("staff roles", () => {
    const uiStaff = Object.fromEntries(ui.PLATFORM_ROLE_TEMPLATES.map((r: { key: string; perms: string[] }) => [r.key, r.perms]));
    expect(api.PLATFORM_ROLES).toEqual(uiStaff);
  });
  it("plans and prices", () => {
    const strip = (p: { id: string; type: string; name: string; price: number; limits: object; features: object }) => ({ id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features });
    expect(PLANS.map(strip)).toEqual(UI_PLANS.map(strip));
    for (const m of [1, 3, 6, 12]) expect(priceFor(3000, m)).toBe(uiPriceFor({ price: 3000 }, m));
  });
});
