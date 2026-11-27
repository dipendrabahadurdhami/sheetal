// Builds the two Android apps (Capacitor) as signed APK files: native/out/Sheetal-Property-<v>.apk and Sheetal-Business-<v>.apk.
// Run from native/:  npm run android:build        (both)      node scripts/android.mjs build business   (one)      … sync   (only copy config)
// Needs: Java 17 and the Android SDK (C:/Users/USER/sheetal-build-tools, or JAVA_HOME / ANDROID_HOME), the signing key native/sheetal-release.keystore
// and its password in native/keystore.env (both kept out of git; keep a safe copy: every update must be signed with the same key).
// How it works: each app loads its part of sheetalproperty.com (capacitor.config.json), so it always shows the newest version.
import { execSync as run } from "node:child_process";
// Runs a command; on failure only its exit code is shown (an error object can carry the environment, which holds the key password).
const execSync = (cmd, o) => { try { return run(cmd, o); } catch (e) { console.error(`Failed (exit ${e.status ?? "?"}): ${cmd.split(" ")[0]}`); process.exit(1); } };
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TOOLS = "C:/Users/USER/sheetal-build-tools";
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME || `${TOOLS}/jdk-17.0.21.1+2`,
  ANDROID_HOME: process.env.ANDROID_HOME || `${TOOLS}/android-sdk`,
};
env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
env.PATH = `${env.JAVA_HOME}/bin;${env.PATH}`;

const version = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version;
const APPS = { customer: "Sheetal-Property", business: "Sheetal-Business" };
const [step = "build", only] = process.argv.slice(2);
const pass = (() => {
  const f = join(here, "keystore.env");
  if (!existsSync(f)) return null;
  return readFileSync(f, "utf8").match(/^KEYSTORE_PASSWORD=(.+)$/m)?.[1]?.trim() ?? null;
})();
if (step === "build" && !pass) { console.error("native/keystore.env (the signing key password) is missing."); process.exit(1); }

mkdirSync(join(here, "out"), { recursive: true });
for (const [kind, file] of Object.entries(APPS)) {
  if (only && only !== kind) continue;
  const dir = join(here, "android", kind);
  console.log(`\n== ${file} ${version}: sync`);
  execSync("npx cap sync android", { cwd: dir, env, stdio: "inherit" });
  if (step !== "build") continue;
  console.log(`== ${file}: build and sign`);
  // Gradle signs the release (app/build.gradle reads the key from these two variables; the password is never on a command line).
  const signEnv = { ...env, SHEETAL_KEYSTORE: join(here, "sheetal-release.keystore"), SHEETAL_KEYSTORE_PASSWORD: pass };
  // The full path: this PC's shell does not run programs from the current folder by name (NoDefaultCurrentDirectoryInExePath).
  execSync(`"${join(dir, "android", "gradlew.bat")}" assembleRelease --no-daemon -q`, { cwd: join(dir, "android"), env: signEnv, stdio: ["ignore", "inherit", "inherit"], shell: true });
  const apk = join(dir, "android/app/build/outputs/apk/release/app-release.apk");
  if (!existsSync(apk)) { console.error(`No signed APK at ${apk}`); process.exit(1); }
  copyFileSync(apk, join(here, "out", `${file}-${version}.apk`));
  console.log(`== ${file}: native/out/${file}-${version}.apk`);
}
