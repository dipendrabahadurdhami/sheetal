// The Sheetal Windows app (Electron): one program, built twice: "Sheetal Property" (the website) and "Sheetal Business" (the ERP).
// How it works: the build writes which app this is into package.json ("sheetalApp": "customer" or "business"); the window opens that part of
// sheetalproperty.com, so the app always shows the newest version without updating. The browser's user agent carries "SheetalApp/windows",
// so the screens switch to app mode (shared/src/core/appMode.js). Links to other sites open in the normal browser; Sheetal's own pages and
// the payment gateways (eSewa, Khalti, Fonepay) stay inside, so a payment comes back to the app. Without internet a local page says so.
// Rules: no Node in the page (contextIsolation, no nodeIntegration, sandbox); one copy at a time; the window's size and place are remembered.

const { app, BrowserWindow, Menu, shell, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const KIND = (() => { try { return require("../package.json").sheetalApp || "customer"; } catch { return "customer"; } })();
const SITE = "https://sheetalproperty.com";
const START = KIND === "business" ? `${SITE}/business/?source=app` : `${SITE}/?source=app`;
const NAME = KIND === "business" ? "Sheetal Business" : "Sheetal Property";
// Pages that stay inside the app: Sheetal and its subdomains, the payment gateways, Google sign-in.
const INSIDE = [/^https:\/\/([a-z0-9-]+\.)?sheetalproperty\.com(\/|$)/i, /^https:\/\/([a-z0-9-]+\.)*esewa\.com\.np\//i, /^https:\/\/([a-z0-9-]+\.)*khalti\.com\//i,
  /^https:\/\/([a-z0-9-]+\.)*fonepay\.com\//i, /^https:\/\/accounts\.google\.com\//i];
const inside = (url) => INSIDE.some((r) => r.test(url));

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId(KIND === "business" ? "com.sheetalproperty.business" : "com.sheetalproperty.app");

const stateFile = () => path.join(app.getPath("userData"), "window.json");
const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return { width: 1280, height: 820 }; } };

let win = null;
function createWindow() {
  const s = readState();
  win = new BrowserWindow({
    title: NAME, width: s.width || 1280, height: s.height || 820, x: s.x, y: s.y, minWidth: 380, minHeight: 600, show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#2b2b2d" : "#ffffff", autoHideMenuBar: true,
    icon: path.join(__dirname, "build", KIND === "business" ? "business.png" : "customer.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  if (s.maximized) win.maximize();
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} SheetalApp/windows`);
  win.once("ready-to-show", () => win.show());

  // Other sites open in the normal browser; Sheetal and the gateways stay here.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (inside(url)) { win.loadURL(url); return { action: "deny" }; }
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!inside(url)) { e.preventDefault(); if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); }
  });
  // No internet (or the site can't be reached): the local offline page, with "Try again".
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, "offline.html"), { query: { back: url || START } });
  });

  const save = () => {
    if (!win) return;
    const b = win.getNormalBounds();
    try { fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch { /* not important */ }
  };
  win.on("close", save);
  win.on("closed", () => { win = null; });
  win.loadURL(START);
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "&App", submenu: [
      { label: "Home", accelerator: "Alt+Home", click: () => win?.loadURL(START) },
      { label: "Back", accelerator: "Alt+Left", click: () => win?.webContents.canGoBack() && win.webContents.goBack() },
      { label: "Forward", accelerator: "Alt+Right", click: () => win?.webContents.canGoForward() && win.webContents.goForward() },
      { type: "separator" }, { role: "reload" }, { type: "separator" }, { role: "quit" },
    ] },
    { label: "&Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "&View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "&Help", submenu: [
      { label: "Sheetal Property website", click: () => shell.openExternal(SITE) },
      { label: "Get the apps", click: () => shell.openExternal(`${SITE}/app`) },
    ] },
  ]));
  createWindow();
});

app.on("window-all-closed", () => app.quit());
