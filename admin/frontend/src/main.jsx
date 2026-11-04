// Entry point of the super-admin panel (/admin).
// How it works: loads the shared theme styles, tells the shared code which paths this app owns, and renders App.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { config } from "@sheetal/shared/core/config";
import "@sheetal/shared/styles/theme.css";

// Public pages render inside this panel's own layout.
config.embedPublic = true;
// Paths outside /admin belong to the website or the other app: links there do a full page load
config.owns = (p) => /^\/admin(\/|$)/.test(p);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
