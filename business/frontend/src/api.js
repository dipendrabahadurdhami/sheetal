// Calls the business API (business/backend). The login token is the one the website stores after signing in
// (same site, same browser), so signing in once works for both.
//   VITE_BUSINESS_API_URL  e.g. http://localhost:4001/v1 (in business/frontend/.env.local)
const BASE = (import.meta.env.VITE_BUSINESS_API_URL || "").replace(/\/+$/, "");

export const bizApiReady = () => !!BASE;
const token = () => { try { return localStorage.getItem("sheetal_token"); } catch { return null; } };
export const signedIn = () => !!token();

export class ApiError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}

export async function bizApi(method, path, body) {
  if (!BASE) throw new ApiError(0, "The business API isn't connected (VITE_BUSINESS_API_URL).");
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
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, json?.message || "Something went wrong.", json?.errors);
    return json;
  }
  if (!res.ok) throw new ApiError(res.status, "Something went wrong.");
  return res.blob();
}

/** A file as base64, for attachments. */
export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] || "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export const formatBytes = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
