// In-app notifications: this file only re-exports platform/src/notify (moved there in P1-BE-4), so every import path keeps working.
// Where it fits: still imported by the website, business and admin APIs and by backend-core itself.
// Rules: no new code imports this path (new code uses @sheetal/platform/notify); it is deleted at the end of Phase 2.
export { notify, notifyStaff, teamWith, leadPeople, type Note } from "@sheetal/platform/notify/index";
