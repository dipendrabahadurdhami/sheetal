// The Listings page moved to apps/listings/frontend (P2-W6); this file keeps the old name for BusinessApp.jsx and passes the panel's reload.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.
import React from "react";
import { ListingsPage as Page } from "@sheetal/app-listings/frontend";
import { workRefresh } from "../live";
export function ListingsPage(props) { return <Page {...props} onChanged={workRefresh} />; }
