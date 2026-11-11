// The business API's two support-session routes: what the banner shows, and "End session".
// Where it fits: business/backend/src/app.ts registers supportSessionRoutes under /v1. The Frontend (P1-FE-4) shows the banner from GET /support/session.
// How it works:
//   GET  /support/session   { data: { active: false } } for a normal sign-in; for a support session the business, the reason, the staff member's name, the end
//                           time, minutes left and whether it is read-only (ACCESS.md 12 point 4: "You are viewing {Business} as Sheetal support · {reason} · {minutes left}").
//   POST /support/end       ends the session (the token stops working at once); allowed in read-only mode.
// Rules: these two routes work with a support token only; a normal sign-in just gets active:false / 400.

import type { FastifyInstance } from "fastify";
import { badRequest } from "../core/errors.js";
import type { Db } from "../db/client.js";
import { endSupportSession } from "./sessions.js";

export async function supportSessionRoutes(app: FastifyInstance & { db?: Db }) {
  app.get("/support/session", async (req) => {
    const s = req.support;
    if (!s) return { data: { active: false } };
    return {
      data: {
        active: true, id: s.id, business: s.business, reason: s.reason, staff: { name: s.staff.userName }, readOnly: s.readOnly,
        startedAt: s.startedAt, expiresAt: s.expiresAt, minutesLeft: Math.max(0, Math.ceil((s.expiresAt.getTime() - Date.now()) / 60_000)),
      },
    };
  });

  app.post("/support/end", async (req) => {
    const s = req.support;
    if (!s || !app.db) throw badRequest("This is not a support session.");
    await endSupportSession(app.db, { id: s.id, endedBy: s.staffId, by: "staff" });
    return { message: "Support session ended." };
  });
}
