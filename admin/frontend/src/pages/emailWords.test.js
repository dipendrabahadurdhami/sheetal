import { describe, expect, it } from "vitest";
import { checkBadge, domainState, headline, since } from "./emailWords.js";

const good = { platformDomain: "sheetalproperty.com", domainAdded: true, connected: true, problems: 0, healthy: true, server: { listening: true, failedLast24h: 0 } };

describe("headline", () => {
  it("says email is working when everything is right", () => expect(headline(good)).toMatchObject({ tone: "done", title: "Email is working" }));
  it("asks to add the domain when it is not added", () => expect(headline({ ...good, domainAdded: false, connected: false, healthy: false })).toMatchObject({ tone: "action", title: "Your email domain isn't added yet" }));
  it("says the domain is not connected when records are wrong", () => expect(headline({ ...good, connected: false, healthy: false, problems: 2 })).toMatchObject({ tone: "action", title: "sheetalproperty.com is not connected yet" }));
  it("says why when it is connected but not healthy", () => {
    const h = headline({ ...good, healthy: false, problems: 1, server: { listening: false, failedLast24h: 2 } });
    expect(h.tone).toBe("progress");
    expect(h.text).toBe("The mail server does not answer; 2 emails failed in the last 24 hours; 1 DNS setting needs a fix.");
  });
  it("uses the singular for one failed email", () => expect(headline({ ...good, healthy: false, server: { listening: true, failedLast24h: 1 } }).text).toBe("1 email failed in the last 24 hours."));
});

describe("checkBadge", () => {
  it("names each state", () => {
    expect(checkBadge({ status: "ok" })).toEqual({ tone: "done", label: "Found" });
    expect(checkBadge({ status: "wrong" })).toEqual({ tone: "problem", label: "Different value" });
    expect(checkBadge({ status: "missing" })).toEqual({ tone: "action", label: "Not set up" });
    expect(checkBadge({ status: "missing", optional: true })).toEqual({ tone: "neutral", label: "Optional, not set" });
  });
});

describe("since", () => {
  const now = new Date("2026-11-17T12:00:00Z").getTime();
  it("speaks in plain time", () => {
    expect(since(null, now)).toBe("never");
    expect(since("2026-11-17T11:59:40Z", now)).toBe("just now");
    expect(since("2026-11-17T11:55:00Z", now)).toBe("5 minutes ago");
    expect(since("2026-11-17T09:00:00Z", now)).toBe("3 hours ago");
    expect(since("2026-11-15T12:00:00Z", now)).toBe("2 days ago");
  });
});

describe("domainState", () => {
  it("is Ready, Needs DNS or Not checked", () => {
    expect(domainState({ verified: true })).toEqual({ tone: "done", label: "Ready" });
    expect(domainState({ verified: false, checks: { mx: "wrong" } })).toEqual({ tone: "action", label: "Needs DNS" });
    expect(domainState({ verified: false, checks: {} })).toEqual({ tone: "neutral", label: "Not checked" });
  });
});
