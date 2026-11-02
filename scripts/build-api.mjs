// Builds one API (run from website/backend, business/backend or admin/backend) into dist/server.js.
// backend-core is bundled in; npm packages stay as normal imports, installed on the server.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const own = JSON.parse(readFileSync("package.json", "utf8"));
const core = JSON.parse(readFileSync(new URL("../backend-core/package.json", import.meta.url), "utf8"));
const external = [...new Set([own, core].flatMap((p) => Object.keys(p.dependencies || {})))].filter((d) => !d.startsWith("@sheetal/"));

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
  logLevel: "info",
});
