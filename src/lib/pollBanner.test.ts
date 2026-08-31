import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLL_BANNER_LINK_LABEL,
  isSafePollBannerUrl,
  normalizePollBannerTone,
  resolvePollBannerSnapshot,
} from "./pollBanner";

describe("isSafePollBannerUrl", () => {
  it("accepts an absolute https url", () => {
    expect(isSafePollBannerUrl("https://forms.gle/abc123")).toBe(true);
  });

  it("accepts an absolute http url", () => {
    expect(isSafePollBannerUrl("http://example.com/survey")).toBe(true);
  });

  it("rejects a javascript: url", () => {
    expect(isSafePollBannerUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a data: url", () => {
    expect(isSafePollBannerUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects a site-relative path", () => {
    expect(isSafePollBannerUrl("/actions/poll")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isSafePollBannerUrl("")).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(isSafePollBannerUrl("   ")).toBe(false);
  });
});

describe("normalizePollBannerTone", () => {
  it("keeps an explicit warning tone", () => {
    expect(normalizePollBannerTone("warning")).toBe("warning");
  });

  it("keeps an explicit info tone", () => {
    expect(normalizePollBannerTone("info")).toBe("info");
  });

  it("falls back to info for an unrecognized value", () => {
    expect(normalizePollBannerTone("danger")).toBe("info");
  });

  it("falls back to info when absent", () => {
    expect(normalizePollBannerTone(undefined)).toBe("info");
  });
});

describe("resolvePollBannerSnapshot", () => {
  const configured = {
    pollBannerEnabled: true,
    pollBannerMessage: "Please fill out the survey here for feedback about the game:",
    pollBannerLinkLabel: "Click Here",
    pollBannerUrl: "https://forms.gle/abc123",
    pollBannerTone: "warning" as const,
  };

  it("returns the configured banner when enabled with a safe url", () => {
    expect(resolvePollBannerSnapshot(configured)).toEqual({
      enabled: true,
      message: "Please fill out the survey here for feedback about the game:",
      linkLabel: "Click Here",
      url: "https://forms.gle/abc123",
      tone: "warning",
    });
  });

  it("returns a disabled snapshot when there is no config document", () => {
    expect(resolvePollBannerSnapshot(null).enabled).toBe(false);
  });

  it("withholds the url while the toggle is off, so a draft link cannot leak", () => {
    const snapshot = resolvePollBannerSnapshot({ ...configured, pollBannerEnabled: false });
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.url).toBe("");
    expect(snapshot.message).toBe("");
  });

  it("disables the banner when enabled but the url is missing", () => {
    const snapshot = resolvePollBannerSnapshot({ ...configured, pollBannerUrl: "" });
    expect(snapshot.enabled).toBe(false);
  });

  it("disables the banner when a stored url is not http or https", () => {
    const snapshot = resolvePollBannerSnapshot({
      ...configured,
      pollBannerUrl: "javascript:alert(1)",
    });
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.url).toBe("");
  });

  it("disables the banner when enabled but the message is blank", () => {
    const snapshot = resolvePollBannerSnapshot({ ...configured, pollBannerMessage: "   " });
    expect(snapshot.enabled).toBe(false);
  });

  it("falls back to the default link label when the admin left it blank", () => {
    const snapshot = resolvePollBannerSnapshot({ ...configured, pollBannerLinkLabel: "" });
    expect(snapshot.linkLabel).toBe(DEFAULT_POLL_BANNER_LINK_LABEL);
  });

  it("trims surrounding whitespace off the admin's text", () => {
    const snapshot = resolvePollBannerSnapshot({
      ...configured,
      pollBannerMessage: "  Take the survey:  ",
      pollBannerLinkLabel: "  Here  ",
    });
    expect(snapshot.message).toBe("Take the survey:");
    expect(snapshot.linkLabel).toBe("Here");
  });
});
