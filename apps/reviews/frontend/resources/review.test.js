// Tests for the Reviews page: the resource description, filter chips → query, the reply body with its version, 409, empty text = remove, canReply, and the star breakdown.
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@sheetal/sdk/client";

vi.mock("@sheetal/ui/primitives", () => ({ Panel: ({ children }) => children }));
vi.mock("@sheetal/shared/core/icons", () => ({ Icon: () => null }));

import { buildUrl } from "../../../../packages/sdk/src/requests.js";
import { removeRecord, runRowAction } from "../../../../packages/ui/src/crud/saveFlow.js";
import en from "../../../../shared/src/i18n/en.js";
import { REMOVE_CONFIRM, REMOVE_TEXT, canSubmit, replyState, submitLabel, textToSend } from "../components/replyLogic.js";
import { SHOW_OPTIONS, barPercent, postReply, replyAction, reviewResource, reviewStats, sendReply, starsPanel } from "./review.jsx";

const row = { id: "rv_02", version: 3 };
const t = (k) => en[k];
const ui = (api) => ({ api, toast: vi.fn(), t, reload: vi.fn() });

describe("resource description", () => {
  it("is read-only: no form, no delete, no permissions of its own", () => {
    expect(reviewResource.form).toBeUndefined();
    expect(reviewResource.remove).toBeUndefined();
    expect(reviewResource.perms).toEqual({});
    expect(reviewResource.path).toBe("/reviews");
    expect(reviewResource.versioned).toBe(true);
  });
  it("has the three chips with the old words", () => {
    expect(SHOW_OPTIONS.map((o) => [o.id, o.label])).toEqual([["all", "All"], ["unanswered", "Waiting for a reply"], ["low", "1 or 2 stars"]]);
    expect(reviewResource.list.filters[0]).toMatchObject({ id: "show", type: "chips", default: "all" });
  });
  it("the chips become ?show= in the address", () => {
    const p = reviewResource.list.params;
    expect(buildUrl("/reviews", p({ show: "all" }))).toBe("/reviews?show=all");
    expect(buildUrl("/reviews", p({ show: "unanswered" }))).toBe("/reviews?show=unanswered");
    expect(buildUrl("/reviews", p({ show: "low" }))).toBe("/reviews?show=low");
    expect(buildUrl("/reviews", p({}))).toBe("/reviews?show=all");
  });
  it("empty states and loading text are the old ones", () => {
    expect(reviewResource.empty({ show: "all" })).toEqual({ icon: "star", title: "No reviews yet", sub: "Reviews people leave on your listings and agency page on the website appear here." });
    for (const show of ["unanswered", "low"]) expect(reviewResource.empty({ show })).toEqual({ icon: "star", title: "Nothing here", sub: "Try another filter." });
    expect(reviewResource.loadingText).toBe("Loading reviews…");
  });
});

describe("stats", () => {
  it("average, reviews and waiting", () => {
    const [avg, count, waiting] = reviewStats({ average: 3.5, count: 2, unanswered: 1 });
    expect([avg.label, avg.value, count.label, count.value, waiting.label, waiting.value, waiting.tone]).toEqual(["Average", 3.5, "Reviews", 2, "Waiting for a reply", 1, "action"]);
  });
  it("no reviews: a dash, a note, and no highlight", () => {
    const [avg, , waiting] = reviewStats({ average: null, count: 0, unanswered: 0 });
    expect(avg.value).toBe("–");
    expect(avg.note).toBe("No reviews yet");
    expect(waiting.tone).toBeUndefined();
  });
  it("the star breakdown shows only when there are reviews; bars are a share of the total", () => {
    expect(starsPanel({ count: 0, stars: [] })).toBeNull();
    expect(starsPanel(null)).toBeNull();
    expect(starsPanel({ count: 2, stars: [{ stars: 5, count: 1 }] })).not.toBeNull();
    expect(barPercent(1, 2)).toBe(50);
    expect(barPercent(0, 0)).toBe(0);
  });
});

describe("reply with version", () => {
  it("posts { text, version } to /reviews/:id/reply", async () => {
    const api = vi.fn(async () => ({ message: "Reply posted. It shows under the review on the website." }));
    await postReply(row, "Thank you!", api);
    expect(api).toHaveBeenCalledWith("POST", "/reviews/rv_02/reply", { text: "Thank you!", version: 3 });
  });
  it("editing and removing carry the version too; empty text removes", async () => {
    const api = vi.fn(async () => ({ message: "ok" }));
    await postReply(row, "Edited", api);
    await postReply(row, REMOVE_TEXT, api);
    expect(api.mock.calls.map((c) => c[2])).toEqual([{ text: "Edited", version: 3 }, { text: "", version: 3 }]);
  });
  it("goes through the same saveFlow as every other page", async () => {
    const api = vi.fn(async () => ({}));
    await runRowAction(reviewResource, replyAction("x"), row, api);
    expect(api).toHaveBeenCalledWith("POST", "/reviews/rv_02/reply", { text: "x", version: 3 });
    await removeRecord(reviewResource, row, api); // not used by the page; shows the version rule is the shared one
    expect(api).toHaveBeenLastCalledWith("DELETE", "/reviews/rv_02?version=3");
  });
  it("success: shows the server's message and reloads", async () => {
    const u = ui(vi.fn(async () => ({ message: "Reply removed." })));
    expect(await sendReply(row, "", u)).toBe(true);
    expect(u.toast).toHaveBeenCalledWith("Reply removed.");
    expect(u.reload).toHaveBeenCalledTimes(1);
  });
  it("409: shows 'Someone changed this. Reload to see the latest.', reloads once, sends once", async () => {
    const api = vi.fn(async () => { throw new ApiError(409, "version_conflict", undefined, "version_conflict"); });
    const u = ui(api);
    expect(await sendReply(row, "Hi", u)).toBe(false);
    expect(u.toast).toHaveBeenCalledWith("Someone changed this. Reload to see the latest.");
    expect(u.reload).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("404 (review hidden or removed meanwhile): shows the server's words and reloads so the card goes away", async () => {
    const api = vi.fn(async () => { throw new ApiError(404, "Review not found."); });
    const u = ui(api);
    expect(await sendReply(row, "Hi", u)).toBe(false);
    expect(u.toast).toHaveBeenCalledWith("Review not found.");
    expect(u.reload).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("another failure (403) shows the server's words and does not reload", async () => {
    const u = ui(vi.fn(async () => { throw new ApiError(403, "You can't reply."); }));
    expect(await sendReply(row, "Hi", u)).toBe(false);
    expect(u.toast).toHaveBeenCalledWith("You can't reply.");
    expect(u.reload).not.toHaveBeenCalled();
  });
});

describe("reply box rules", () => {
  it("Remove asks first, in plain words", () => {
    expect(REMOVE_CONFIRM).toEqual({ title: "Remove your reply?", text: "Its text is deleted.", confirmLabel: "Remove" });
  });
  it("canReply false hides the box and the buttons; a saved reply is still shown", () => {
    expect(replyState({ reply: null, canReply: false, editing: false })).toBe("none");
    expect(replyState({ reply: "Thanks", canReply: false, editing: false })).toBe("reply-only");
    expect(replyState({ reply: "Thanks", canReply: false, editing: true })).toBe("none");
  });
  it("canReply true: a box when there is no reply, Edit / Remove when there is, the box again while editing", () => {
    expect(replyState({ reply: null, canReply: true, editing: false })).toBe("box");
    expect(replyState({ reply: "Thanks", canReply: true, editing: false })).toBe("reply");
    expect(replyState({ reply: "Thanks", canReply: true, editing: true })).toBe("box");
  });
  it("button words, trimmed text, and no empty post", () => {
    expect(submitLabel(null)).toBe("Post reply");
    expect(submitLabel("Thanks")).toBe("Save reply");
    expect(textToSend("  hello  ")).toBe("hello");
    expect(canSubmit("   ", false)).toBe(false);
    expect(canSubmit("hi", true)).toBe(false);
    expect(canSubmit("hi", false)).toBe(true);
    expect(REMOVE_TEXT).toBe("");
  });
});
