// Tests of the parts of Reviews that need no database: the screen's input rules, the presenter, the event payload and the Phase 1 scope cap.
// Where it fits: runs with the app's own tests: npm run test -w @sheetal/app-reviews (no PostgreSQL needed).
// How it works: plain functions in, plain values out. The database-backed checks are in business/backend/test/reviews-kernel.test.ts (and the old review test in branches.test.ts).
// Rules: a change to a message or a number here is a change the screen will show.
import { describe, expect, it } from "vitest";
import { forbidden } from "@sheetal/platform/core/errors";
import type { PermissionSet } from "@sheetal/platform/core/context";
import manifest from "../../app.manifest.js";
import { REVIEW_EVENTS, repliedPayload } from "../events.js";
import { present, summary } from "../presenter.js";
import { cappedPermissions } from "../scope.js";
import { ListQuery, ReplyBody, versionIn } from "../schemas.js";
import type { ListingBrief, ReviewRow } from "../types.js";

const review = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  id: "r1", tenantId: null as unknown as string, userId: "u1", listingId: 5, rating: 4, comment: "Nice", status: "published", reply: null, repliedAt: null, repliedBy: null,
  version: 1, createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-01"), createdBy: null, updatedBy: null, deletedAt: null, deletedBy: null, ...over,
} as ReviewRow);
const listings = new Map<number, ListingBrief>([[5, { id: 5, code: "SP-5", title: "Lake house", slug: "lake-house" }]]);

describe("input rules", () => {
  it("lists with show=all by default and refuses an unknown filter", () => {
    expect(ListQuery.parse({})).toEqual({ show: "all" });
    expect(ListQuery.parse({ show: "low" })).toEqual({ show: "low" });
    expect(() => ListQuery.parse({ show: "x" })).toThrow();
  });
  it("trims the reply, allows empty (take it down) and at most 1500 characters", () => {
    expect(ReplyBody.parse({ text: "  Thanks  " })).toEqual({ text: "Thanks" });
    expect(ReplyBody.parse({ text: "" })).toEqual({ text: "" });
    expect(() => ReplyBody.parse({ text: "x".repeat(1501) })).toThrow();
    expect(() => ReplyBody.parse({})).toThrow();
  });
  it("reads the version a page loaded: absent is fine, a bad one is refused", () => {
    expect(versionIn({ text: "a" })).toBeUndefined();
    expect(versionIn(undefined)).toBeUndefined();
    expect(versionIn({ version: 3 })).toBe(3);
    expect(versionIn({ version: "4" })).toBe(4);
    expect(() => versionIn({ version: 0 })).toThrow();
    expect(() => versionIn({ version: "x" })).toThrow();
  });
});

describe("presenter", () => {
  it("shows a listing review with its link, and the person by name", () => {
    expect(present(review(), listings, new Map([["u1", "Sita"]]))).toMatchObject({
      about: "listing", listing: { code: "SP-5", title: "Lake house", link: "/property/lake-house" }, by: "Sita", reply: null, repliedBy: null, version: 1,
    });
  });
  it("shows a business review as 'business' and an unknown person as 'Sheetal user'", () => {
    const r = present(review({ listingId: null, tenantId: "t1", repliedBy: "u2", reply: "Thanks" }), listings, new Map([["u2", "Owner"]]));
    expect(r).toMatchObject({ about: "business", listing: null, by: "Sheetal user", repliedBy: "Owner" });
  });
  it("counts, averages to one decimal, and breaks down the stars", () => {
    const s = summary([{ rating: 5, reply: null }, { rating: 4, reply: "x" }, { rating: 2, reply: null }], true);
    expect(s).toMatchObject({ count: 3, unanswered: 2, average: 3.7, canReply: true });
    expect(s.stars).toEqual([{ stars: 5, count: 1 }, { stars: 4, count: 1 }, { stars: 3, count: 0 }, { stars: 2, count: 1 }, { stars: 1, count: 0 }]);
    expect(summary([], false)).toMatchObject({ count: 0, average: null, canReply: false });
  });
});

describe("event", () => {
  it("uses the name and payload of the manifest", () => {
    const published = manifest.events.publishes[0]!;
    expect(REVIEW_EVENTS.replied).toBe(published.name);
    expect(Object.keys(repliedPayload(review())).sort()).toEqual(Object.keys(published.payload).sort());
    expect(repliedPayload(review({ reply: "Thanks" }))).toEqual({ reviewId: "r1", hasReply: true });
    expect(repliedPayload(review())).toEqual({ reviewId: "r1", hasReply: false });
  });
});

describe("Phase 1 scope cap", () => {
  const all: PermissionSet = {
    can: () => true, scopeOf: () => "all", canAny: () => true,
    require: (_p, m) => { if (m === "deny") throw forbidden("no"); return "all"; },
  };
  it("narrows 'all' to 'branch' and never widens", () => {
    const p = cappedPermissions(all);
    expect(p.scopeOf("reviews.review.read")).toBe("branch");
    expect(p.require("reviews.review.read")).toBe("branch");
    expect(cappedPermissions({ ...all, scopeOf: () => "own", require: () => "own" }).require("reviews.review.read")).toBe("own");
    expect(cappedPermissions({ ...all, scopeOf: () => null }).scopeOf("x")).toBeNull();
  });
  it("keeps the old refusal texts", () => {
    const refuse: PermissionSet = { ...all, require: (_p, m) => { throw forbidden(m ?? "default"); } };
    const p = cappedPermissions(refuse);
    expect(() => p.require("reviews.review.reply")).toThrow("Your role can't reply to reviews.");
    expect(() => p.require("reviews.review.read")).toThrow("Your role can't see reviews.");
  });
});
