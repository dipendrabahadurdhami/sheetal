// POS screens, for the Business app: `import { PosPage, StockPage } from "@sheetal/app-pos/frontend"`.
// Where it fits: apps/pos/package.json maps "./frontend" here; business/frontend/vite.config.js points Vite at it.
// Rules: an app never imports another app or a Business page; this folder imports only the kit packages and shared.
export { PosPage } from "./pages/PosPage.jsx";
export { StockPage } from "./pages/StockPage.jsx";
