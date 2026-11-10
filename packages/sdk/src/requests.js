// The plain helpers behind the API hooks, with no React and no UI in them: the address builder, the response split, the race guard
// (makeLoader) and the registry that lets a write refresh the lists on screen.
// Where it fits: hooks.js uses them; hooks.test.ts tests them without a browser.
// How it works: see each function. Rules: keep this file free of imports so it loads anywhere (tests, the server, a worker).

/** "/expenses" + { status: "draft", month: "" } → "/expenses?status=draft". Empty, null and undefined values are left out; keys are sorted so the same params always give the same address. */
export function buildUrl(path, params = {}) {
  const parts = Object.keys(params || {}).sort()
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`);
  if (!parts.length) return path;
  return path + (path.includes("?") ? "&" : "?") + parts.join("&");
}

/** { data, meta } from a response: an array is the rows; an object with `rows` is the rows plus meta; any other object is meta only. */
export function splitResponse(res) {
  const data = res?.data;
  const baseMeta = res?.meta && typeof res.meta === "object" ? res.meta : {};
  if (Array.isArray(data)) return { rows: data, meta: baseMeta };
  if (data && typeof data === "object") {
    const { rows, ...rest } = data;
    return { rows: Array.isArray(rows) ? rows : [], meta: { ...rest, ...baseMeta } };
  }
  return { rows: [], meta: baseMeta };
}

/**
 * One request at a time counts. start() cancels the earlier one's right to report: when its answer arrives late, it is dropped.
 * `run(fn, onOk, onFail)`: fn() returns a promise; only the newest call's result reaches onOk / onFail. cancel() drops everything
 * in flight (used when the component goes away). Kept separate from React so the race can be tested without a browser.
 */
export function makeLoader() {
  let latest = 0;
  return {
    run(fn, onOk, onFail) {
      const mine = ++latest;
      return Promise.resolve().then(fn).then(
        (v) => { if (mine === latest) onOk(v); },
        (e) => { if (mine === latest) onFail(e); },
      );
    },
    cancel() { latest++; },
  };
}

// Lists that are on screen, by path, so a write can refresh them: Map<path, Set<refresh>>.
const lists = new Map();
export const register = (path, fn) => {
  const key = path.split("?")[0];
  if (!lists.has(key)) lists.set(key, new Set());
  lists.get(key).add(fn);
  return () => { lists.get(key)?.delete(fn); if (!lists.get(key)?.size) lists.delete(key); };
};
/** Refresh every list on screen whose path equals or sits under one of `paths`. */
export function invalidate(paths = []) {
  for (const [key, fns] of lists) {
    if (paths.some((p) => key === p || key.startsWith(`${p}/`))) fns.forEach((f) => f());
  }
}

