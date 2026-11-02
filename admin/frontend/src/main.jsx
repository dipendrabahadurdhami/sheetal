import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { config } from "@sheetal/shared/core/config";
import "@sheetal/shared/styles/theme.css";

// Theme is shared with the website through <html data-theme>
config.embedPublic = true;
// Paths outside /admin belong to the website or the other app: links there do a full page load
config.owns = (p) => /^\/admin(\/|$)/.test(p);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
