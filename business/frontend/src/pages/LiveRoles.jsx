// The role screen moved to apps/workspace/frontend (P2-W6); this file keeps the old name and passes the panel's team reload.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.
import React from "react";
import { RolesPage } from "@sheetal/app-workspace/frontend";
import { liveRefresh } from "../live";
export function LiveRoles(props) { return <RolesPage {...props} onChanged={liveRefresh} />; }
