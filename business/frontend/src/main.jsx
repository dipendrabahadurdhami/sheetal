// Entry point of the business panel (/business).
// How it works: loads the shared theme styles, tells the shared code which paths this app owns, and renders App.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { config } from "@sheetal/shared/core/config";
import "@sheetal/shared/styles/theme.css";
import { startAppMode } from "@sheetal/shared/core/appMode";

// Installed-app mode and the offline service worker (shared/src/core/appMode.js).
startAppMode({ production: import.meta.env.PROD });

// Public pages (a shared listing, a form) render inside this panel's own layout.
config.embedPublic = true;
// Paths outside /business belong to the website or the other app: links there do a full page load
config.owns = (p) => /^\/business(\/|$)/.test(p);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
