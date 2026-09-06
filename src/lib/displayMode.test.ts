import { describe, expect, it } from "vitest";
import {
  isClientShellUserAgent,
  isInAppWebViewUserAgent,
  isNativeAppUserAgent,
} from "./displayMode";

const CAPACITOR =
  "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36 AHD-Android/0.4.0";
const SHELL_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36 AHDClient-Mobile/2.1.0";
const SHELL_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AHDClient-Mobile/2.1.0";
const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

describe("in-app webview user agents", () => {
  it("keeps the Capacitor marker as the only chrome-suppressing agent", () => {
    expect(isNativeAppUserAgent(CAPACITOR)).toBe(true);
    expect(isNativeAppUserAgent(SHELL_ANDROID)).toBe(false);
    expect(isNativeAppUserAgent(SHELL_IOS)).toBe(false);
  });

  it("recognises the AHDClient mobile shell on both platforms", () => {
    expect(isClientShellUserAgent(SHELL_ANDROID)).toBe(true);
    expect(isClientShellUserAgent(SHELL_IOS)).toBe(true);
    expect(isClientShellUserAgent(CAPACITOR)).toBe(false);
    expect(isClientShellUserAgent(BROWSER)).toBe(false);
  });

  it("treats either marker as an in-app webview and browsers as neither", () => {
    expect(isInAppWebViewUserAgent(CAPACITOR)).toBe(true);
    expect(isInAppWebViewUserAgent(SHELL_IOS)).toBe(true);
    expect(isInAppWebViewUserAgent(BROWSER)).toBe(false);
    expect(isInAppWebViewUserAgent("")).toBe(false);
  });
});
