// Workspace screens, for the Business app: `import { MailPage, TeamPage, RolesPage } from "@sheetal/app-workspace/frontend"`.
// Where it fits: apps/workspace/package.json maps "./frontend" here; the business front-end depends on this package.
// Rules: an app never imports another app or a Business page; this folder imports only the kit packages and shared.
export { MailPage } from "./pages/MailPage.jsx";
export { TeamPage, toMember, toInvite, toRole, memberBody, activityText } from "./pages/TeamPage.jsx";
export { RolesPage } from "./pages/RolesPage.jsx";
