// Public marketplace pages (stays, projects, business sites, checkout) inside the website.
// Rules: /admin and /business are separate apps (admin/frontend and business/frontend).

import React from "react";
import { StoreProvider, useStore } from "@sheetal/shared/core/store";
import { I18nProvider, useT } from "@sheetal/shared/core/i18n";
import { RouterProvider, Link, useRouter } from "@sheetal/shared/core/router";
import { ToastProvider } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { config } from "@sheetal/shared/core/config";
import PublicApp from "./PublicApp";
import "@sheetal/shared/styles/platform.css";

import { themeAttr, useSharedTheme } from "@sheetal/shared/core/theme";

export default function PlatformApp({ mode = "history" }) {
  return (
    <StoreProvider>
      <Frame mode={mode} />
    </StoreProvider>
  );
}

// Theme: each app (website, /business, /admin) keeps its own, applied through <html data-theme> (see shared/core/theme.js).
function useSiteTheme() {
  const { db, update } = useStore();
  useSharedTheme(db.session.theme, (v) => update((d) => { d.session.theme = v; }));
}

function Frame({ mode }) {
  const { db } = useStore();
  useSiteTheme();
  return (
    <I18nProvider lang={db.session.lang}>
      <div className="pf-root" data-theme={config.embedPublic ? undefined : themeAttr(db.session.theme)}>
        <ToastProvider>
          <RouterProvider mode={mode}><Switch /></RouterProvider>
        </ToastProvider>
      </div>
    </I18nProvider>
  );
}

function Switch() {
  const { path } = useRouter();
  if (/^\/(admin|business)(\/|$)/.test(path)) return <OtherApp />;
  if (path !== "/" && path !== "") return <PublicApp />;
  return <Landing />;
}

function Landing() {
  const t = useT();
  return (
    <div className="pf-landing">
      <div className="brand"><img src={config.logo} alt="" /><span className="brand-word"><b>SHEETAL</b><span>PLATFORM</span></span></div>
      <h1>{t("landing.title")}</h1>
      <p>{t("landing.sub")}</p>
      <div className="pf-landing-grid">
        <Link to="/admin" className="card pf-landing-card"><Icon name="shield-check" size={26} /><b>{t("landing.admin")}</b><span>{t("landing.adminSub")}</span><code>/admin</code></Link>
        <Link to="/business" className="card pf-landing-card"><Icon name="store" size={26} /><b>{t("landing.business")}</b><span>{t("landing.businessSub")}</span><code>/business</code></Link>
        <Link to="/home" className="card pf-landing-card"><Icon name="globe" size={26} /><b>{t("landing.public")}</b><span>{t("landing.publicSub")}</span><code>/home · /stays · /project · /investment · /account</code></Link>
      </div>
    </div>
  );
}

// /admin and /business are their own apps. In development the website server forwards those paths to them,
// so a full page load opens the right app. The guard stops a reload loop if that app isn't running.
function OtherApp() {
  const { path } = useRouter();
  const key = "sheetal_open_" + path;
  const tried = (() => { try { return sessionStorage.getItem(key) === "1"; } catch (e) { return false; } })();
  React.useEffect(() => { if (!tried) { try { sessionStorage.setItem(key, "1"); } catch (e) { /* ignore */ } window.location.reload(); } else { try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ } } }, []);
  if (!tried) return null;
  const app = path.startsWith("/admin") ? "admin" : "business";
  return (
    <div className="pf-landing">
      <h1>The {app} app isn't running</h1>
      <p>Start everything from the sheetal folder with <code>npm run dev</code>, then open this page again.</p>
    </div>
  );
}
