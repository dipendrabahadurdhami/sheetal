// App-level settings shared by the three front-ends (logo, base paths, demo switches).
// Where it fits: each app's main.jsx sets its own values before rendering.
// Rules: `demo` must be false in production (it shows "Reset demo" and the role switcher to everyone).

export const config = {
  logo: "/brand/logo-mark.png",
  storageKey: "shetal_platform_demo",
  // true when public pages render inside your existing site layout (your header and footer)
  embedPublic: false,
  // which paths belong to this app; links to other paths do a full page load (set in each app's main.jsx)
  owns: null,
  // Demo mode shows "Reset demo", the role switcher and the Super admin link for everyone. Set to false for production.
  demo: true,
};
