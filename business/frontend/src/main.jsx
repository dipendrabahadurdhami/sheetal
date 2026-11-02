import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { config } from "@sheetal/shared/core/config";
import "@sheetal/shared/styles/theme.css";

// Theme is applied through <html data-theme>; this panel keeps its own choice
config.embedPublic = true;
// Paths outside /business belong to the website or the other app: links there do a full page load
config.owns = (p) => /^\/business(\/|$)/.test(p);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
