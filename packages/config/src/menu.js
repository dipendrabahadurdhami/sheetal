// Menu items from the app manifests (FOLDERS-AND-MOVE-PLAN.md step 11, FRONTEND-KIT.md section 8).
// Where it fits: the business shell (business/frontend/src/pages/BusinessApp.jsx) builds the sidebar entries of the apps that are on the kernel from here;
// the entries of the apps still waiting for Phase 2 stay written in the shell. Import it as @sheetal/config/menu.
// How it works: manifestNavItem(path) finds the manifest menu entry with that path in the generated registry (apps.generated.js) and returns it in the
// shape filterNav() already understands: { to, icon, key, permAny, types }. `key` is the i18n key the old menu used ("nav.<menu id>"), so the words stay
// the same; the permission names are the NEW ones (can() accepts both through the alias layer until stage 1.5 removes it).
// Rules: data only, no React. A path with no manifest entry returns null (the shell drops it), so a missing manifest never breaks the menu. Plan rules
// ("paid") are the shell's until Phase 3 replaces plans: pass them in `extra`.

import { APPS } from "./apps.generated.js";

/** Every manifest menu entry with the app it belongs to, in manifest order. */
export function manifestMenu(apps = APPS) {
  return apps.flatMap((app) => (app.menu || []).map((item) => ({ app, item })));
}

/** The sidebar entry for one path, or null when no manifest declares it. `extra` is merged last (for example { paid: true }). */
export function manifestNavItem(path, extra = {}, apps = APPS) {
  const found = manifestMenu(apps).find((x) => x.item.path === path);
  if (!found) return null;
  const { app, item } = found;
  const perms = item.anyPermission?.length ? [...item.anyPermission] : item.permission ? [item.permission] : null;
  return {
    to: item.path, icon: item.icon, key: `nav.${item.id}`, app: app.id, group: item.group, order: item.order,
    ...(perms ? { permAny: perms } : {}),
    ...(app.businessTypes === "all" ? {} : { types: [...app.businessTypes] }),
    ...extra,
  };
}

/** The paths the manifests declare (the shell uses it to know which pages are "on the kernel"). */
export const manifestPaths = (apps = APPS) => manifestMenu(apps).map((x) => x.item.path);
