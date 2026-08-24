import { describe, expect, it } from "vitest";
import {
  GOOGLE_CONSENT_MODE_REGION_CODES,
  getAdSensePageTagUrl,
  buildGoogleTagBootstrapScript,
  isGoogleCmpSiteHost,
  isPrivacyMessagingExcludedPath,
  shouldRenderGooglePrivacyMessaging,
  shouldRenderConsentManagedGoogleTags,
} from "@/lib/googlePrivacyMessaging";

describe("googlePrivacyMessaging", () => {
  it("keeps the privacy policy page free of consent-managed tags", () => {
    expect(isPrivacyMessagingExcludedPath("/privacy")).toBe(true);
    expect(shouldRenderConsentManagedGoogleTags("/privacy")).toBe(false);
    expect(shouldRenderConsentManagedGoogleTags("/news")).toBe(true);
  });

  it("only treats configured production hosts as CMP-eligible", () => {
    expect(isGoogleCmpSiteHost("ahousedividedgame.com")).toBe(true);
    expect(isGoogleCmpSiteHost("www.ahousedividedgame.com")).toBe(true);
    expect(isGoogleCmpSiteHost("preview-ahd.vercel.app")).toBe(false);
    expect(isGoogleCmpSiteHost("localhost:3000")).toBe(false);
  });

  it("limits Google privacy messaging to reviewed editorial pages", () => {
    const originalClientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
    process.env.NEXT_PUBLIC_ADSENSE_CLIENT = "ca-pub-1234567890";

    try {
      expect(shouldRenderGooglePrivacyMessaging("/guides", "ahousedividedgame.com")).toBe(true);
      expect(shouldRenderGooglePrivacyMessaging("/dashboard", "ahousedividedgame.com")).toBe(false);
      expect(
        shouldRenderGooglePrivacyMessaging("/wiki/getting-started", "ahousedividedgame.com")
      ).toBe(false);
    } finally {
      if (originalClientId === undefined) delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
      else process.env.NEXT_PUBLIC_ADSENSE_CLIENT = originalClientId;
    }
  });

  it("builds consent defaults for Google's regulated regions when consent mode is enabled", () => {
    const script = buildGoogleTagBootstrapScript("G-TEST123", "cmp");

    expect(script).toContain(`gtag('config', "G-TEST123");`);
    expect(script).toContain(`"analytics_storage":"denied"`);
    expect(script).toContain(`"ad_storage":"denied"`);
    expect(script).toContain(`"wait_for_update":500`);
    expect(script).toContain(`"region":${JSON.stringify([...GOOGLE_CONSENT_MODE_REGION_CODES])}`);
    expect(script).toContain(`"analytics_storage":"granted"`);
  });

  it("omits consent defaults when consent mode is disabled", () => {
    const script = buildGoogleTagBootstrapScript("G-TEST123", "none");

    expect(script).toContain(`gtag('config', "G-TEST123");`);
    expect(script).not.toContain(`gtag('consent', 'default'`);
  });

  it("uses denied-by-default fallback consent when Google CMP is unavailable", () => {
    const script = buildGoogleTagBootstrapScript("G-TEST123", "fallback");

    expect(script).toContain(`window.localStorage.getItem("ahd-cookie-consent")`);
    expect(script).toContain(`"analytics_storage":"denied"`);
    expect(script).toContain(`"wait_for_update":500`);
    expect(script).toContain(`"analytics_storage":"granted"`);
  });

  it("builds the standard AdSense page tag URL", () => {
    expect(getAdSensePageTagUrl("ca-pub-1234567890")).toBe(
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890"
    );
  });
});
