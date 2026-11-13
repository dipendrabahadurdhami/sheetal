// The Inbox moved to apps/crm/frontend (P2-W6); this file keeps the old name for BusinessApp.jsx and passes in the lead finder (AIStudio, a Business
// page an app may not import) and the top bar's unread re-count.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.
import React from "react";
import { InboxPage } from "@sheetal/app-crm/frontend";
import { workRefresh } from "../live";
import { AIStudio } from "./AI";
export function Inbox({ tenant }) { return <InboxPage tenant={tenant} Finder={AIStudio} onChanged={workRefresh} />; }
