// React hooks for reading and writing through the API: useApiList, useApiGet, useApiMutation.
// Where it fits: the kit's CrudPage uses them; P1-FE-2 (Expenses) is the first screen on them. Replaces the hand-written useLoad of LiveExpenses.
// How it works: a list or a single record loads when the open business, the picked branch, the params or refresh() change. A late
// answer to an older request never replaces a newer one (see makeLoader). A write toasts the server's message and refreshes the
// lists registered under the paths named in `invalidate`.
// Rules: no new npm package. The plain helpers (address builder, response split, the race guard, the refresh registry) are in requests.js so they
// can be tested without loading the UI. The response shape is { data, meta?, message? } as bizApi returns it; `data` may be an array, or an
// object holding `rows` (today's /expenses) whose other keys become `meta`.

import { useCallback, useEffect, useRef, useState } from "react";
import { useBranch } from "@sheetal/shared/core/branch";
import { useToast } from "@sheetal/ui/primitives";
import { ApiError, bizApi, getActiveTenant } from "./client.js";
import { buildUrl, invalidate, makeLoader, register, splitResponse } from "./requests.js";

export { buildUrl, invalidate, makeLoader, splitResponse };

function useLoad(path, params, opts, shape) {
  const api = opts.api || bizApi;
  const branch = useBranch()?.branch;
  const tenant = opts.tenantId ?? getActiveTenant();
  const url = path === null || path === undefined || opts.skip ? null : buildUrl(path, params);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ res: null, error: null, loading: !!url });
  const loader = useRef(null);
  if (!loader.current) loader.current = makeLoader();
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!url) { setState({ res: null, error: null, loading: false }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    loader.current.run(() => api("GET", url),
      (res) => setState({ res, error: null, loading: false }),
      (e) => setState((s) => ({ res: s.res, error: e instanceof ApiError ? e : new ApiError(0, e?.message || "Something went wrong."), loading: false })));
    return () => loader.current.cancel();
  }, [url, tenant, branch, tick, api]);

  useEffect(() => (path ? register(path, refresh) : undefined), [path, refresh]);
  return { ...shape(state.res), error: state.error, loading: state.loading, refresh };
}

/**
 * A list that reloads when the open business, the picked branch, the params or refresh() change.
 * `opts`: { api (default bizApi), skip, tenantId (default: the open business set with setActiveTenant) }.
 * Returns { rows: T[] | null, meta: object | null, error: ApiError | null, loading: boolean, refresh() }; rows stay the last good list while a reload runs.
 */
export function useApiList(path, params = {}, opts = {}) {
  const shape = useCallback((res) => (res ? splitResponse(res) : { rows: null, meta: null }), []);
  return useLoad(path, params, opts, shape);
}

/** One record (or one report). Returns { data, error, loading, refresh }; `data` is the response's `data`. */
export function useApiGet(path, opts = {}) {
  const shape = useCallback((res) => ({ data: res ? res.data : null }), []);
  return useLoad(path, {}, opts, shape);
}

/**
 * A write. run(body?, pathArg?) sends it and returns the response; the server's message is shown as a toast (successToast: false to
 * skip), and lists registered under `invalidate` reload. `pathOrFn`: "/expenses", or (arg) => `/expenses/${arg}` to build the path from pathArg.
 * Returns { run, busy, error }. A failed write throws the ApiError too, so the caller can map error.errors (422) onto fields.
 */
export function useApiMutation(method, pathOrFn, opts = {}) {
  const api = opts.api || bizApi;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async (body, pathArg) => {
    const path = typeof pathOrFn === "function" ? pathOrFn(pathArg) : pathOrFn;
    setBusy(true); setError(null);
    try {
      const res = await api(method, path, body);
      if (opts.successToast !== false && res?.message) toast(res.message);
      if (opts.invalidate?.length) invalidate(opts.invalidate);
      return res;
    } catch (e) {
      if (alive.current) setError(e);
      throw e;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [method, typeof pathOrFn === "function" ? "fn" : pathOrFn, api, toast, opts.successToast, (opts.invalidate || []).join("|")]);
  return { run, busy, error };
}

/**
 * What the open business may use now, app by app (GET /entitlements, P3-FE-2). Returns { mode, loading, refresh, accessOf(appId),
 * editionOf(appId), limitOf(appId, key), hasApp(appId), seats, ai }. While it loads, or for a business on today's plans, every app counts as
 * available ("full"), so nothing is hidden or locked by mistake: the server still refuses what isn't allowed.
 */
export function useEntitlements(opts = {}) {
  const { data, loading, error, refresh } = useApiGet("/entitlements", opts);
  return entitlementsView(data, { loading, error, refresh });
}

/** The plain part of useEntitlements (tested without React). */
export function entitlementsView(data, extra = {}) {
  const apps = new Map((data?.apps || []).map((a) => [a.appId, a]));
  const mode = data?.mode || null;
  const exact = mode === "apps";
  const accessOf = (appId) => (exact ? apps.get(appId)?.access ?? "none" : "full");
  return {
    ...extra, mode,
    accessOf,
    hasApp: (appId) => accessOf(appId) !== "none",
    editionOf: (appId) => apps.get(appId)?.edition ?? null,
    limitOf: (appId, key) => { const v = apps.get(appId)?.limits?.[key]; return v === undefined || v === -1 ? null : v; },
    seats: data?.seats || null,
    ai: data?.ai || "locked",
  };
}
