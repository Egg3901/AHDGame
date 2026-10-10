import { describe, expect, it } from "vitest";
import {
  appCallbackIntent,
  appHandbackPage,
  oauthStateFor,
  shouldHandBackToApp,
} from "./appOAuthHandback";

const APP_UA =
  "Mozilla/5.0 (Linux; Android 16; SM-S928B; wv) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36 AHDClient-Mobile/2.5.0";
const IOS_APP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 AHDClient-Mobile/2.5.0";
const SAMSUNG_BROWSER =
  "Mozilla/5.0 (Linux; Android 16; SM-S928B) AppleWebKit/537.36 SamsungBrowser/28.0 Chrome/130 Mobile Safari/537.36";

describe("Discord sign-in hand-back to the Android app", () => {
  it("marks only sign-ins started in the Android app", () => {
    expect(oauthStateFor(APP_UA, "abc")).toBe("app-abc");
    expect(oauthStateFor(IOS_APP_UA, "abc")).toBe("abc");
    expect(oauthStateFor(SAMSUNG_BROWSER, "abc")).toBe("abc");
    expect(oauthStateFor(null, "abc")).toBe("abc");
  });

  it("hands back a marked callback that landed in a browser", () => {
    expect(shouldHandBackToApp("app-abc", "code123", SAMSUNG_BROWSER)).toBe(true);
  });

  it("never hands back unmarked, incomplete, malformed or in-app callbacks", () => {
    expect(shouldHandBackToApp("abc", "code123", SAMSUNG_BROWSER)).toBe(false);
    expect(shouldHandBackToApp("app-abc", null, SAMSUNG_BROWSER)).toBe(false);
    expect(shouldHandBackToApp("app-abc", "a b", SAMSUNG_BROWSER)).toBe(false);
    expect(shouldHandBackToApp('app-"><script>', "code", SAMSUNG_BROWSER)).toBe(false);
    // Already in the app with no cookies: a real expiry, not a hand-off.
    expect(shouldHandBackToApp("app-abc", "code123", APP_UA)).toBe(false);
  });

  it("targets the app package with the exact callback", () => {
    const callback = new URL(
      "https://ahousedividedgame.com/api/auth/discord/callback?code=c1&state=app-s1"
    );
    expect(appCallbackIntent(callback)).toBe(
      "intent://ahousedividedgame.com/api/auth/discord/callback?code=c1&state=app-s1#Intent;scheme=https;package=net.lakesidegames.ahdclient;end"
    );
  });

  it("serves an uncached page with an escaped return link", async () => {
    const response = appHandbackPage(
      new URL("https://ahousedividedgame.com/api/auth/discord/callback?code=c1&state=app-s1")
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await response.text();
    expect(html).toContain("Return to the app");
    expect(html).toContain("code=c1&amp;state=app-s1");
  });
});
