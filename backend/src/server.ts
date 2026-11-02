import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

// Start the API. Reads backend/.env if present (Node's built-in loader), then the real environment.
try { process.loadEnvFile(); } catch { /* no .env file: use the environment as is */ }

const config = loadConfig();
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
