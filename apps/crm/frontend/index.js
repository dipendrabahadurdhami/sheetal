// CRM screens, for the Business app: `import { InboxPage } from "@sheetal/app-crm/frontend"`.
// Where it fits: apps/crm/package.json maps "./frontend" here; the business front-end depends on this package.
// Rules: an app never imports another app or a Business page; the lead finder is passed in as `Finder` (see InboxPage.jsx).
export { InboxPage, CHANNELS, STAGES, editBody } from "./pages/InboxPage.jsx";
