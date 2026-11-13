// The Email page moved to apps/workspace/frontend (P2-W6); this file keeps the old name so BusinessApp.jsx doesn't change, and passes the top bar's re-count.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.
import React from "react";
import { MailPage } from "@sheetal/app-workspace/frontend";
import { mailCountRefresh } from "../live";
export function Mail() { return <MailPage onRead={mailCountRefresh} />; }
