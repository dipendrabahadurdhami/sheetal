// Business settings moved to apps/workspace/frontend (P2-W6); this file keeps the old name for BusinessApp.jsx and the old helper imports
// (defaultTenantSettings, mergeSettings, BRAND_PRESETS), and passes in the logo-and-colours editor and the listing-code field (Business pages).
// Rules: no new code imports this path; it is deleted at the end of Phase 2.
import React from "react";
import { SettingsPage } from "@sheetal/app-workspace/frontend";
import { workspacesReload } from "../live";
import { settingsRefresh } from "../liveSettings";
import { BrandFromLogo } from "./BrandFromLogo";
import { CodePrefix } from "./CodePrefix";
export { BRAND_PRESETS, defaultTenantSettings, mergeSettings } from "@sheetal/app-workspace/frontend/settingsModel";
export function BusinessSettings(props) {
  return <SettingsPage {...props} Branding={BrandFromLogo} CodePrefix={CodePrefix} onChanged={() => { settingsRefresh(); workspacesReload(); }} />;
}
