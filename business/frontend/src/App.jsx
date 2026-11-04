// Top of the business panel: store, language, theme and router, then BusinessApp.
// How it works: each app keeps its own theme choice through <html data-theme> (see shared/src/core/theme.js).

import React from "react";
import { StoreProvider, useStore } from "@sheetal/shared/core/store";
import { I18nProvider } from "@sheetal/shared/core/i18n";
import { RouterProvider, match, useRouter } from "@sheetal/shared/core/router";
import { ToastProvider } from "@sheetal/shared/core/ui";
import { config } from "@sheetal/shared/core/config";
import BusinessApp from "./pages/BusinessApp";
import { PublicForm } from "./pages/Forms";
import { AcceptInvite } from "./pages/AcceptInvite";
import "@sheetal/shared/styles/platform.css";

import { themeAttr, useSharedTheme } from "@sheetal/shared/core/theme";

export default function App() {
  return (
    <StoreProvider>
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
  return (
    <I18nProvider lang={db.session.lang}>
      <div className="pf-root" data-theme={config.embedPublic ? undefined : themeAttr(db.session.theme)}>
        <ToastProvider>
          <RouterProvider mode="history"><Gate /></RouterProvider>
        </ToastProvider>
      </div>
    </I18nProvider>
  );
}

// Public forms (/business/f/:slug) and team invitations (/business/accept-invite) open on their own,
// without the workspace shell (the invited person may not be in any business yet).
function Gate() {
  const { path } = useRouter();
  const m = match("/business/f/:slug", path);
  if (m) return <PublicForm slug={m.slug} />;
  if (path === "/business/accept-invite") return <AcceptInvite />;
  return <BusinessApp />;
}
