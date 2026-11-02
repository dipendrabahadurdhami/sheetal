// App-level config. The host app can override before rendering <PlatformApp />.
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
