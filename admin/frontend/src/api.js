// Calls the admin API (admin/backend). The login token is the one the website stores after signing in
// (same site, same browser); only Sheetal staff (people with a platform role) get answers.
//   VITE_ADMIN_API_URL  e.g. http://localhost:4002/v1 (in admin/frontend/.env.local)
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
