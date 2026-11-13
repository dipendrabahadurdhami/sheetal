// Hotel screens, for the Business app: `import { FrontDeskPage, BookingsPage, CalendarPage } from "@sheetal/app-hotel/frontend"`.
// Where it fits: apps/hotel/package.json maps "./frontend" here; business/frontend/vite.config.js points Vite at it.
// Rules: an app never imports another app or a Business page; this folder imports only the kit packages and shared.
export { FrontDeskPage, BookingsPage, CalendarPage } from "./pages/HotelPages.jsx";
