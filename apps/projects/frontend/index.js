// Projects screens, for the Business app: `import { ProjectsPage } from "@sheetal/app-projects/frontend"`.
// Where it fits: apps/projects/package.json maps "./frontend" here; business/frontend/vite.config.js points Vite at it.
// Rules: an app never imports another app; this folder imports only the kit packages and shared.
export { ProjectsPage } from "./pages/ProjectsPage.jsx";
