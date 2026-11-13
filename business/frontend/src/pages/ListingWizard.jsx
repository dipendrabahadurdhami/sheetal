// The listing wizard moved to apps/listings/frontend (P2-W6); this file keeps the old name for BusinessApp.jsx and passes in the AI fill (AIStudio)
// and the panel's reload. Counter is re-exported for the invoice screen.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.
import React from "react";
import { ListingWizard as Wizard } from "@sheetal/app-listings/frontend";
import { workRefresh } from "../live";
import { AIStudio } from "./AI";
export { Counter } from "@sheetal/app-listings/frontend";
export function ListingWizard(props) { return <Wizard {...props} Ai={AIStudio} onChanged={workRefresh} />; }
