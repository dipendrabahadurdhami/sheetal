// Top of the business panel: store, language, theme and router, then BusinessApp.
// How it works: each app keeps its own theme choice through <html data-theme> (see shared/src/core/theme.js).

import React from "react";
import { StoreProvider, useStore } from "@sheetal/shared/core/store";
import { I18nProvider } from "@sheetal/shared/core/i18n";
import { RouterProvider, match, useRouter } from "@sheetal/shared/core/router";
import { ToastProvider } from "@sheetal/shared/core/ui";
import { config } from "@sheetal/shared/core/config";
import BusinessApp from "./pages/BusinessApp";
import { AcceptInvite } from "./pages/AcceptInvite";
import "@sheetal/shared/styles/platform.css";

import { themeAttr, useSharedTheme } from "@sheetal/shared/core/theme";

const UI_KEYS = ["session", "drafts"];

export default function App() {
  return (
    // Only UI state is kept in the browser (who is signed in to which business, open drafts); business data always comes from the API (P2-W6).
    <StoreProvider storageKey="sheetal_business_ui" keep={UI_KEYS}>
      <Frame />
    </StoreProvider>
  );
}

// Theme: each app (website, /business, /admin) keeps its own, applied through <html data-theme> (see shared/core/theme.js).
function useSiteTheme() {
  const { db, update } = useStore();
  useSharedTheme(db.session.theme, (v) => update((d) => { d.session.theme = v; }));
}

function Frame() {
  const { db } = useStore();
  useSiteTheme();
  // The open business's type picks its own words (rooms and guests for a hotel, properties and clients for an agency…).
  return (
    <I18nProvider lang={db.session.lang} type={db.tenants?.find((x) => x.id === db.session.tenantId)?.type || null}>
      <div className="pf-root" data-theme={config.embedPublic ? undefined : themeAttr(db.session.theme)}>
        <ToastProvider>
          <RouterProvider mode="history"><Gate /></RouterProvider>
        </ToastProvider>
      </div>
    </I18nProvider>
  );
}

// Team invitations (/business/accept-invite) open on their own, without the workspace shell (the invited person may not be in any business yet).
// An old public-form link (/business/f/:slug) goes to the website's form page (/f/:slug), where online forms live since the sample was removed.
function Gate() {
  const { path } = useRouter();
  const m = match("/business/f/:slug", path);
  if (m) { if (typeof window !== "undefined") window.location.replace(`/f/${encodeURIComponent(m.slug)}`); return null; }
  if (path === "/business/accept-invite") return <AcceptInvite />;
  return <BusinessApp />;
}
