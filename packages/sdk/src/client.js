// The API client every screen uses: createApi() makes a client for one API, bizApi is the business one.
// Where it fits: bizApi(method, path, body) everywhere the panel talks to the server (moved from business/frontend/src/api.js, task P1-FE-1;
// that file is now a shim, so every old import still works).
// How it works: sends the sign-in token (the same one the website stores, so one sign-in covers both), the open business
// (x-tenant-id) and the picked branch (x-branch); turns error replies into ApiError with the server's message.
// Rules: set VITE_BUSINESS_API_URL in business/frontend/.env.local (e.g. http://localhost:4001/v1); without it the panel shows the
// sample workspace only. The address is read here from import.meta.env, which Vite fills in for the app being built (see CHANGES).

export class ApiError extends Error {
  /** `code` and `requestId` are new: the server may send { code: "version_conflict" } in the body and an x-request-id header. */
  constructor(status, message, errors, code, requestId) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * One API client. `baseUrl`: the address up to and including /v1 (empty = not connected). `tokenKey`: the localStorage key of the
 * sign-in token. `tenantHeader`: send x-tenant-id and x-branch. `name`: used in the "isn't connected" message.
 * Returns { api, ready, signedIn, setActiveTenant, setActiveBranch, getActiveTenant, getActiveBranch }.
 */
export function createApi({ baseUrl, tokenKey = "sheetal_token", tenantHeader = true, name = "business", envName = "VITE_BUSINESS_API_URL" } = {}) {
  const BASE = (baseUrl || "").replace(/\/+$/, "");
  const token = () => { try { return localStorage.getItem(tokenKey); } catch { return null; } };
  // The business the panel has open; sent with every call so the API acts in that business.
  let activeTenant = null;
  // The branch picked in the top bar (a branch id, or "all"); the API shows and files work under it.
  let activeBranch = null;

  async function api(method, path, body) {
    if (!BASE) throw new ApiError(0, `The ${name} API isn't connected (${envName}).`);
    const headers = { Accept: "application/json" };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    if (tenantHeader && activeTenant) headers["x-tenant-id"] = activeTenant;
    if (tenantHeader && activeTenant && activeBranch) headers["x-branch"] = activeBranch;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
    }
    const requestId = res.headers.get("x-request-id") || undefined;
    if ((res.headers.get("content-type") || "").includes("application/json")) {
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, json?.message || "Something went wrong.", json?.errors, json?.code, requestId);
      return json;
    }
    if (!res.ok) throw new ApiError(res.status, "Something went wrong.", undefined, undefined, requestId);
    return res.blob();
  }

  return {
    api,
    ready: () => !!BASE,
    signedIn: () => !!token(),
    setActiveTenant: (id) => { activeTenant = id || null; },
    setActiveBranch: (id) => { activeBranch = id || null; },
    getActiveTenant: () => activeTenant,
    getActiveBranch: () => activeBranch,
  };
}

// The business API. import.meta.env.VITE_BUSINESS_API_URL is replaced by Vite while it builds the app that imports this file,
// so /business, /admin and the website each get the value from their own env files, exactly as api.js did before.
const biz = createApi({ baseUrl: import.meta.env.VITE_BUSINESS_API_URL });
export const bizApi = biz.api;
export const bizApiReady = biz.ready;
export const signedIn = biz.signedIn;
export const setActiveTenant = biz.setActiveTenant;
export const setActiveBranch = biz.setActiveBranch;
export const getActiveTenant = biz.getActiveTenant;
export const getActiveBranch = biz.getActiveBranch;

/** A file as base64, for attachments. */
export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] || "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export const formatBytes = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
