import { describe, expect, it } from "vitest";
import {
  formatTicketPlatform,
  isTicketPlatform,
  platformFromDescriptionPrefix,
  platformFromUserAgent,
} from "./platform";

const IOS_APP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AHDClient-Mobile/2.3.20";
const ANDROID_APP =
  "Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro XL Build/CP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 AHDClient-Mobile/2.3.22";

describe("platformFromUserAgent", () => {
  it("tells the iOS and Android apps apart by the device in front of the app marker", () => {
    expect(platformFromUserAgent(IOS_APP)).toBe("mobile_ios");
    expect(platformFromUserAgent(ANDROID_APP)).toBe("mobile_android");
    expect(platformFromUserAgent("Mozilla/5.0 (Linux; Android 14) AHD-Android")).toBe(
      "mobile_android"
    );
  });

  it("recognises the desktop client, single player and plain browsers", () => {
    expect(platformFromUserAgent("Mozilla/5.0 (Windows NT 10.0) AHDClient-Desktop/2.3.19")).toBe(
      "desktop_client"
    );
    expect(platformFromUserAgent("anything", { singleplayer: true })).toBe("desktop_singleplayer");
    expect(
      platformFromUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1.15"
      )
    ).toBe("mobile_web");
    expect(
      platformFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36")
    ).toBe("desktop_web");
    expect(platformFromUserAgent(undefined)).toBe("desktop_web");
  });
});

describe("platformFromDescriptionPrefix", () => {
  it("recovers the bot's Platform prefix and ignores anything else", () => {
    expect(platformFromDescriptionPrefix("Platform: Mobile: iOS app\n\nThe menu is cut off")).toBe(
      "mobile_ios"
    );
    expect(platformFromDescriptionPrefix("platform: desktop: web browser\n\nx")).toBe(
      "desktop_web"
    );
    expect(platformFromDescriptionPrefix("Platform: Smart fridge\n\nx")).toBeUndefined();
    expect(platformFromDescriptionPrefix("The menu is cut off")).toBeUndefined();
  });
});

describe("labels", () => {
  it("matches the bot's labels and passes unknown values through", () => {
    expect(formatTicketPlatform("mobile_ios")).toBe("Mobile: iOS app");
    expect(formatTicketPlatform("legacy")).toBe("legacy");
    expect(isTicketPlatform("desktop_client")).toBe(true);
    expect(isTicketPlatform("mobile")).toBe(false);
  });
});
