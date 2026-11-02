import React from "react";
import { StoreProvider, useStore } from "@sheetal/shared/core/store";
import { I18nProvider } from "@sheetal/shared/core/i18n";
import { RouterProvider } from "@sheetal/shared/core/router";
import { ToastProvider } from "@sheetal/shared/core/ui";
import { config } from "@sheetal/shared/core/config";
import AdminApp from "./pages/AdminApp";
import "@sheetal/shared/styles/platform.css";

import { themeAttr, useSharedTheme } from "@sheetal/shared/core/theme";

export default function App() {
  return (
    <StoreProvider>
      <Frame />
    </StoreProvider>
  );
}

// Theme is shared by the website, /admin and /business through <html data-theme> (see shared/core/theme.js).
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
          <RouterProvider mode="history"><AdminApp /></RouterProvider>
        </ToastProvider>
      </div>
    </I18nProvider>
  );
}
