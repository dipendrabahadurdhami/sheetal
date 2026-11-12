// Starts the admin API on ADMIN_API_PORT (4002 by default), with its background jobs.
// How it works: loads backend-core/.env, builds the app and listens; stops cleanly on Ctrl+C.

import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { buildApp } from "./app.js";

loadEnvFiles();

const config = loadConfig(process.env, "admin");
const app = await buildApp(config);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error(err, "could not start");
  process.exit(1);
}
