// Builds the two Windows installers with electron-builder: "Sheetal Property Setup x.y.z.exe" and "Sheetal Business Setup x.y.z.exe".
// Run from native/:  npm run desktop:build            (both)      node scripts/desktop.mjs business   (one)
// How it works: the same Electron program (desktop/main.js) is packed twice; extraMetadata.sheetalApp tells it which app it is. Output goes to
// native/desktop-dist/<app>/. The installers are not code-signed yet (Windows shows "unknown publisher" once); a certificate can be added later.
import { Arch, build, Platform } from "electron-builder";

const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
const APPS = {
  customer: { appId: "com.sheetalproperty.app", productName: "Sheetal Property", icon: "desktop/build/customer.ico" },
  business: { appId: "com.sheetalproperty.business", productName: "Sheetal Business", icon: "desktop/build/business.ico" },
};
const only = process.argv[2];
for (const [kind, a] of Object.entries(APPS)) {
  if (only && only !== kind) continue;
  console.log(`Building ${a.productName} ${pkg.version}…`);
  await build({
    targets: Platform.WINDOWS.createTarget("nsis", Arch.x64),
    config: {
      appId: a.appId, productName: a.productName, copyright: "Shetal Sanshee Technologies P. Ltd.",
      directories: { output: `desktop-dist/${kind}`, buildResources: "desktop/build" },
      files: ["desktop/**/*", "package.json"],
      extraMetadata: { main: "desktop/main.js", sheetalApp: kind, name: a.appId.split(".").pop() === "app" ? "sheetal-property" : "sheetal-business" },
      win: { icon: a.icon, target: [{ target: "nsis", arch: ["x64"] }], artifactName: `${a.productName.replace(/ /g, "-")}-Setup-${pkg.version}.exe` },
      nsis: {
        oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true,
        shortcutName: a.productName, installerIcon: a.icon, uninstallerIcon: a.icon, uninstallDisplayName: a.productName,
      },
      compression: "maximum",
    },
  });
}
console.log("Done. Installers are in native/desktop-dist/.");
