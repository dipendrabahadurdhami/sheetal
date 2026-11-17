// Where each website request goes: the real API, or the local sample data.
// How it works: VITE_API_URL is the API address (e.g. http://localhost:4000/v1); VITE_API_LIVE lists the paths the API
// serves (comma separated, or "*" for all). Other paths are answered by demo/api so pages keep working.
// Rules: sends the sign-in token; turns error replies into errors with the server's message.

import { mockRequest } from "../demo/api/router";

const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const LIVE = String(import.meta.env.VITE_API_LIVE || "").split(",").map((s) => s.trim().replace(/^\/+/, "")).filter(Boolean);
const isLive = (url) => !!API_URL && (LIVE.includes("*") || LIVE.some((p) => url.slice(1) === p || url.slice(1).startsWith(`${p}/`)));

/** True when this path is answered by the real API rather than demo data. */
/** The API address, e.g. https://api.sheetalproperty.com/v1 (empty in sample mode). */
export const apiBase = API_URL;
export const isLivePath = (path) => isLive("/" + String(path).replace(/^\/+/, ""));
export const getMode = () => (!API_URL || !LIVE.length ? "mock" : LIVE.includes("*") ? "live" : "mixed");
export const setMode = () => {};
export const onSourceChange = (fn) => { fn(getMode() === "mock" ? "demo" : "api"); return () => {}; };

const normaliseError = (e) => {
  const err = new Error(e?.response?.data?.message || e?.message || "Something went wrong");
  err.status = e?.response?.status;
  err.errors = e?.response?.data?.errors;
  err.data = e?.response?.data;
  return err;
};

async function liveRequest(method, url, { params, data }) {
  const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString() : "";
  const headers = { Accept: "application/json" };
  let token = null;
  try { token = localStorage.getItem("sheetal_token"); } catch { /* storage off */ }
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (data instanceof FormData) body = data;
  else if (data !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(data); }
  const res = await fetch(`${API_URL}${url}${qs ? `?${qs}` : ""}`, { method: method.toUpperCase(), headers, body, credentials: "include" });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw { response: { status: res.status, data: json || { message: "Something went wrong" } } };
  return json;
}

export async function request(method, path, { params, data } = {}) {
  const url = "/" + String(path).replace(/^\/+/, "");
  try {
    return isLive(url) ? await liveRequest(method, url, { params, data }) : await mockRequest(method, url, { params, data });
  } catch (e) { throw normaliseError(e); }
}

// ── Response helpers ──
export const toList = (r) => {
  const items = Array.isArray(r) ? r
    : Array.isArray(r?.data) ? r.data
    : Array.isArray(r?.data?.data) ? r.data.data
    : [];
  const total = r?.meta?.total ?? r?.total ?? r?.data?.total ?? items.length;
  const last = r?.meta?.last_page ?? r?.last_page ?? r?.data?.last_page ?? 1;
  return { items, total: Number(total) || items.length, last: Number(last) || 1 };
};
export const toItem = (r) => (r && typeof r === "object" && "data" in r && r.data && !Array.isArray(r.data) ? r.data : r);
