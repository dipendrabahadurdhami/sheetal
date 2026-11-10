// The requests behind CrudPage's buttons, with no React in them: save, delete, row action, and what to do when one fails.
// Where it fits: CrudPage calls these; saveFlow.test.js tests them with a fake api, so the version round-trip and the 409 rule are checked without a browser.
// How it works: when a resource says `versioned: true`, every change to an existing record carries the `version` the page loaded: in the body
// (change, confirm, row actions) or as ?version= (delete). The server refuses a stale one with 409 version_conflict; failureKind() tells CrudPage to
// show "Someone changed this. Reload to see the latest." and reload the list. Nothing here ever sends a request a second time.
// Rules: no silent retry; a create never carries a version; custom `run` / `submit` functions get the api and the version so they can send it too.

import { ApiError } from "@sheetal/sdk/client";

/** "?version=3" for a delete, or "" when the resource is not versioned or the record has none. */
export const versionQuery = (resource, row) => (resource.versioned && row?.version != null ? `?version=${row.version}` : "");
/** { version: 3 } to merge into a body, or {}. */
export const versionBody = (resource, row) => (resource.versioned && row?.version != null ? { version: row.version } : {});

/** Is this the server saying "someone else changed it" (409 version_conflict)? */
export const isConflict = (e) => e instanceof ApiError && e.status === 409 && (!e.code || e.code === "version_conflict");

/** What to do with a failed request: "conflict" (banner + reload), "fields" (422 errors under the fields) or "message" (toast the server's words). */
export function failureKind(e) {
  if (isConflict(e)) return "conflict";
  if (e instanceof ApiError && e.status === 422 && e.errors) return "fields";
  return "message";
}

/**
 * Do what a failed request calls for, through the screen's own callbacks: { conflict(), reload(), fields(errors, message), message(text) }.
 * A stale version calls conflict() then reload() (once, never a retry); field errors go to fields(); anything else shows the server's words.
 */
export function reactToFailure(e, ui) {
  const kind = failureKind(e);
  if (kind === "conflict") { ui.conflict(); ui.reload(); }
  else if (kind === "fields") ui.fields(e.errors, e.message);
  else ui.message(e.message);
  return kind;
}

/** Save the form: a chosen mode (such as Confirm), a change (PUT) or a create (POST). Returns the server's answer. */
export function submitRecord(resource, { row, mode }, body, api) {
  const withVersion = row ? { ...body, ...versionBody(resource, row) } : body;
  const modeDef = mode && resource.modes?.[mode];
  if (modeDef) return modeDef.submit(row, withVersion, api);
  if (row) return api("PUT", `${resource.path}/${row.id}`, withVersion);
  return api("POST", resource.path, body);
}

/** Delete (or skip) a record, sending the version. */
export const removeRecord = (resource, row, api) => api("DELETE", `${resource.path}/${row.id}${versionQuery(resource, row)}`);

/** A row action: the resource's own `run(row, api, { version })`, or POST <path>/<id>/<action id> with the version in the body. */
export function runRowAction(resource, action, row, api) {
  const v = versionBody(resource, row);
  if (action.run) return action.run(row, api, v);
  return api("POST", `${resource.path}/${row.id}/${action.id}`, Object.keys(v).length ? v : undefined);
}
