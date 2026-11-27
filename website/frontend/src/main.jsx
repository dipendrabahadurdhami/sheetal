// Entry point of the public website (sheetalproperty.com).
// How it works: loads the shared styles, sets up SEO and analytics, and renders App.

import "./utils/focusScroll";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import "@sheetal/shared/styles/theme.css";
import { startAppMode } from "@sheetal/shared/core/appMode";

// Installed-app mode and the offline service worker (shared/src/core/appMode.js).
startAppMode({ production: import.meta.env.PROD });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
