import pino from "pino";
import { loadEnvFiles } from "@sheetal/backend-core/config";
import { createDb } from "@sheetal/backend-core/lib/db";
import { loadMailConfig } from "./config.js";
import { apiHandOff, createInboundServer } from "./inbound.js";
import { OutboundWorker } from "./outbound.js";
import { SystemSender } from "./system.js";

// Sheetal's mail server: receives mail for business domains (SMTP on port 25), sends the queued business mail and
// Sheetal's own system emails.
// Runs as its own process on the VPS (see docs/mail-server.md).
loadEnvFiles();
const config = loadMailConfig();
const log = pino({ level: config.LOG_LEVEL, base: { service: "mail" } });
const db = createDb(config.DATABASE_URL);
if (!db) { log.fatal("DATABASE_URL is not set"); process.exit(1); }

const say = (msg: string, extra?: object) => log.info(extra ?? {}, msg);
const inbound = createInboundServer({ db, config, handOff: apiHandOff(config), log: say });
inbound.on("error", (err) => log.error({ err }, "smtp error"));
inbound.listen(config.SMTP_PORT, config.SMTP_BIND, () => log.info({ port: config.SMTP_PORT, host: config.MAIL_HOST }, "receiving mail"));

const worker = new OutboundWorker({ db, config, log: say });
const timer = setInterval(() => { worker.tick().catch((err) => log.error({ err }, "sending pass failed")); }, config.OUTBOUND_EVERY * 1000);
log.info({ everySeconds: config.OUTBOUND_EVERY }, "sending queued mail");
// System emails from the outbox (verify, reset, invites, invoices, reminders).
const system = new SystemSender({ db, config, log: say });
const systemTimer = setInterval(() => { system.tick().catch((err) => log.error({ err }, "system email pass failed")); }, config.OUTBOUND_EVERY * 1000);
log.info({ mode: config.SYSTEM_MAIL_MODE, from: config.SYSTEM_MAIL_FROM, ...(config.SYSTEM_MAIL_MODE === "file" ? { savedIn: config.MAIL_DROP_DIR } : {}) }, "sending system emails");

const shutdown = (signal: string) => {
  log.info({ signal }, "shutting down");
  clearInterval(timer);
  clearInterval(systemTimer);
  inbound.close(() => { void db.$disconnect().then(() => process.exit(0)); });
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
