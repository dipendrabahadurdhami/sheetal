// Tests for the requests behind CrudPage's buttons: the version round-trip and the 409 rule. A fake api stands in for the server.
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@sheetal/sdk/client";
import { failureKind, isConflict, reactToFailure, removeRecord, runRowAction, submitRecord, versionBody, versionQuery } from "./saveFlow.js";
import en from "../../../../shared/src/i18n/en.js";

const res = { path: "/things", versioned: true, modes: { confirm: { submit: (row, body, api) => api("POST", `/things/${row.id}/confirm`, body) } } };
const row = { id: "t1", version: 4 };
const fake = () => vi.fn(async () => ({ message: "ok", data: {} }));

describe("version round-trip", () => {
  it("a change (PUT) carries the version the row was loaded with", async () => {
    const api = fake();
    await submitRecord(res, { row, mode: null }, { amount: 5 }, api);
    expect(api).toHaveBeenCalledWith("PUT", "/things/t1", { amount: 5, version: 4 });
  });
  it("a create (POST) carries no version", async () => {
    const api = fake();
    await submitRecord(res, { row: null, mode: null }, { amount: 5 }, api);
    expect(api).toHaveBeenCalledWith("POST", "/things", { amount: 5 });
  });
  it("a mode such as Confirm gets the version in its body", async () => {
    const api = fake();
    await submitRecord(res, { row, mode: "confirm" }, { amount: 9 }, api);
    expect(api).toHaveBeenCalledWith("POST", "/things/t1/confirm", { amount: 9, version: 4 });
  });
  it("a delete carries the version in the address", async () => {
    const api = fake();
    await removeRecord(res, row, api);
    expect(api).toHaveBeenCalledWith("DELETE", "/things/t1?version=4");
  });
  it("a row action posts the version; a custom run() is handed it", async () => {
    const api = fake();
    await runRowAction(res, { id: "pause" }, row, api);
    expect(api).toHaveBeenCalledWith("POST", "/things/t1/pause", { version: 4 });
    const run = vi.fn();
    await runRowAction(res, { id: "x", run }, row, api);
    expect(run).toHaveBeenCalledWith(row, api, { version: 4 });
  });
  it("a resource that is not versioned sends nothing extra", async () => {
    const api = fake();
    const plain = { path: "/things" };
    await submitRecord(plain, { row, mode: null }, { a: 1 }, api);
    await removeRecord(plain, row, api);
    await runRowAction(plain, { id: "pause" }, row, api);
    expect(api.mock.calls).toEqual([["PUT", "/things/t1", { a: 1 }], ["DELETE", "/things/t1"], ["POST", "/things/t1/pause", undefined]]);
    expect(versionQuery(plain, row)).toBe("");
    expect(versionBody(res, { id: "x" })).toEqual({});
  });
});

describe("failures", () => {
  const conflict = new ApiError(409, "Changed.", undefined, "version_conflict");
  it("recognises a stale version, and only that", () => {
    expect(isConflict(conflict)).toBe(true);
    expect(isConflict(new ApiError(409, "Changed."))).toBe(true);
    expect(isConflict(new ApiError(409, "Already exists.", undefined, "duplicate"))).toBe(false);
    expect(isConflict(new ApiError(500, "Boom"))).toBe(false);
    expect(failureKind(new ApiError(422, "Check the form.", { amount: ["Too small."] }))).toBe("fields");
    expect(failureKind(new ApiError(403, "No."))).toBe("message");
    expect(failureKind(new Error("offline"))).toBe("message");
  });
  it("409: shows the conflict, reloads once, and never sends the request again", async () => {
    const api = vi.fn(async () => { throw conflict; });
    const ui = { conflict: vi.fn(), reload: vi.fn(), fields: vi.fn(), message: vi.fn() };
    await submitRecord(res, { row, mode: null }, { amount: 5 }, api).catch((e) => reactToFailure(e, ui));
    expect(ui.conflict).toHaveBeenCalledTimes(1);
    expect(ui.reload).toHaveBeenCalledTimes(1);
    expect(ui.message).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("422 goes to the fields; anything else shows the server's words", () => {
    const ui = { conflict: vi.fn(), reload: vi.fn(), fields: vi.fn(), message: vi.fn() };
    reactToFailure(new ApiError(422, "Check the form.", { note: ["Say what it is for."] }), ui);
    expect(ui.fields).toHaveBeenCalledWith({ note: ["Say what it is for."] }, "Check the form.");
    reactToFailure(new ApiError(403, "You can't do that."), ui);
    expect(ui.message).toHaveBeenCalledWith("You can't do that.");
    expect(ui.reload).not.toHaveBeenCalled();
  });
  it("the words shown for a conflict are the agreed ones", () => {
    expect(en["kit.conflict"]).toBe("Someone changed this. Reload to see the latest.");
  });
});
