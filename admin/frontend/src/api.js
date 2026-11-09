// Calls to the admin API (admin/backend), used by every live admin screen.
// How it works: sends the sign-in token (the same one the website stores); only Sheetal staff get answers.
// Rules: set VITE_ADMIN_API_URL in admin/frontend/.env.local (e.g. http://localhost:4002/v1); without it the panel
// shows sample data only.

const BASE = (import.meta.env.VITE_ADMIN_API_URL || "").replace(/\/+$/, "");

export const adminApiReady = () => !!BASE;
const token = () => { try { return localStorage.getItem("sheetal_token"); } catch { return null; } };
export const signedIn = () => !!token();

export class ApiError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}

export async function adminApi(method, path, body) {
  if (!BASE) throw new ApiError(0, "The admin API isn't connected (VITE_ADMIN_API_URL).");
  const headers = { Accept: "application/json" };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.message || "Something went wrong.", json?.errors);
  return json;
}

/** Downloads a file the admin API makes (CSV exports) and saves it under `name`. */
export async function adminDownload(path, name) {
  if (!BASE) throw new ApiError(0, "The admin API isn't connected (VITE_ADMIN_API_URL).");
  const headers = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) { const j = await res.json().catch(() => null); throw new ApiError(res.status, j?.message || "Something went wrong."); }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
