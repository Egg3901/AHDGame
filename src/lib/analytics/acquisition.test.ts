import { describe, expect, it } from "vitest";
import {
  acquisitionEventProperties,
  acquisitionFromRequest,
  coarseDomain,
  parseAcquisition,
  serializeAcquisition,
} from "./acquisition";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const visit = (url: string, referer: string | null) => {
  const u = new URL(url, "https://ahousedividedgame.com");
  return acquisitionFromRequest({
    pathname: u.pathname,
    searchParams: u.searchParams,
    referer,
    now: NOW,
  });
};

describe("coarseDomain", () => {
  it("keeps the registrable part only", () => {
    expect(coarseDomain("old.reddit.com")).toBe("reddit.com");
    expect(coarseDomain("www.google.com")).toBe("google.com");
    expect(coarseDomain("news.bbc.co.uk")).toBe("bbc.co.uk");
    expect(coarseDomain("localhost")).toBeUndefined();
  });
});

describe("acquisitionFromRequest", () => {
  it("records an external referrer's domain without its path", () => {
    expect(visit("/", "https://old.reddit.com/r/somesub/comments/abc/secret_title/")).toEqual({
      referrerDomain: "reddit.com",
      landing: "home",
      firstSeenAt: NOW / 1000,
    });
  });

  it("records campaign tags, lowercased, and drops unsafe ones", () => {
    expect(visit("/register?utm_source=Reddit&utm_medium=cpc&utm_campaign=<script>", null)).toEqual(
      {
        referrerDomain: "direct",
        utmSource: "reddit",
        utmMedium: "cpc",
        landing: "register",
        firstSeenAt: NOW / 1000,
      }
    );
  });

  it("ignores our own hosts and untagged internal visits", () => {
    expect(visit("/", "https://ahousedividedgame.com/wiki")).toBeNull();
    expect(visit("/", "https://wiki.ahousedividedgame.com/")).toBeNull();
    expect(visit("/", null)).toBeNull();
    expect(visit("/", "not a url")).toBeNull();
  });
});

describe("cookie round trip", () => {
  it("serializes and parses back to the same record", () => {
    const a = visit("/wiki/x?utm_source=discord", "https://discord.com/channels/1/2");
    expect(a).not.toBeNull();
    expect(parseAcquisition(serializeAcquisition(a!))).toEqual(a);
  });

  it("rejects tampered or oversized values", () => {
    expect(parseAcquisition("r=evil.example/path&l=home&t=1")).toBeNull();
    expect(parseAcquisition("r=reddit.com&l=admin&t=1")).toBeNull();
    expect(parseAcquisition("r=reddit.com&l=home&t=-5")).toBeNull();
    expect(parseAcquisition("x".repeat(500))).toBeNull();
    expect(parseAcquisition(undefined)).toBeNull();
  });
});

describe("acquisitionEventProperties", () => {
  it("emits token-safe properties", () => {
    expect(
      acquisitionEventProperties({
        referrerDomain: "reddit.com",
        utmSource: "reddit",
        landing: "home",
        firstSeenAt: 1,
      })
    ).toEqual({ referrer_domain: "reddit_com", landing: "home", utm_source: "reddit" });
    expect(acquisitionEventProperties(null)).toEqual({ referrer_domain: "none" });
  });
});
