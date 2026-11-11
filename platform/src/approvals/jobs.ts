// The approvals expiry job: pending requests nobody decided in time become "expired".
// Where it fits: an API lists approvalExpiryJob(db, log) in its jobs registry (platform/src/jobs/registry.ts); the business API adds it in app.ts next to businessJobs().
// How it works: every 10 minutes (first run 90 seconds after start) it calls expirePending(): each overdue request is taken once, an audit row is written and the maker is told.
// Rules: safe to run on two processes at once (each request is taken by one compare-and-set). A run that throws is logged by the registry and the timer carries on.

import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client.js";
import type { JobSpec } from "../jobs/registry.js";
import { expirePending } from "./service.js";

export const APPROVAL_EXPIRY_EVERY_MS = 10 * 60_000;
export const APPROVAL_EXPIRY_FIRST_RUN_MS = 90_000;

export function approvalExpiryJob(db: Db, log: Pick<FastifyBaseLogger, "warn" | "info">): JobSpec {
  return {
    id: "workspace.approval-expiry", everyMs: APPROVAL_EXPIRY_EVERY_MS, firstRunMs: APPROVAL_EXPIRY_FIRST_RUN_MS,
    failMessage: "approval expiry failed",
    run: async () => {
      const n = await expirePending(db, new Date(), log);
      if (n) log.info({ expired: n }, "approval requests expired");
    },
  };
}
