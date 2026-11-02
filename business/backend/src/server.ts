import { loadConfig, loadEnvFiles } from "@sheetal/backend-core/config";
import { buildApp } from "./app.js";

// Start the business API (port 4001 unless BUSINESS_API_PORT says otherwise).
loadEnvFiles();

const config = loadConfig(process.env, "business");
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
