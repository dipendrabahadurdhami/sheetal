// Invoicing screens, for the Business app: `import { InvoicesPage } from "@sheetal/app-invoicing/frontend"`.
// Where it fits: apps/invoicing/package.json maps "./frontend" here; business/frontend/vite.config.js points Vite at it.
// Rules: an app never imports another app or a Business page; the invoice screen itself is passed in as `View` (see InvoicesPage.jsx).
export { InvoicesPage, toInv, draftBody } from "./pages/InvoicesPage.jsx";
