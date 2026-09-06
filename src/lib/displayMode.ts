export type DisplayMode = "focused" | "classic";

declare global {
  interface Window {
    __AHD_DISPLAY_MODE?: DisplayMode | null;
  }
}

/** Server-side: native Capacitor WebView UA marker. */
export function isNativeAppUserAgent(userAgent: string): boolean {
  return userAgent.includes("AHD-Android");
}

/**
 * The AHDClient mobile shell (Android and iOS). It keeps the site's own
 * navbar and footer, unlike the Capacitor app, but must not carry ad slots,
 * consent prompts or the cookie banner inside an app webview.
 */
export function isClientShellUserAgent(userAgent: string): boolean {
  return userAgent.includes("AHDClient-Mobile/");
}

/** Any in-app webview: no ads, no consent prompts, no cookie banner. */
export function isInAppWebViewUserAgent(userAgent: string): boolean {
  return isNativeAppUserAgent(userAgent) || isClientShellUserAgent(userAgent);
}

/**
 * True when site chrome (navbar, footer) is suppressed.
 * Matches NavbarWrapper / SiteFooter: `displayMode === "focused"`.
 */
export function isFocusedDisplayMode(displayMode?: DisplayMode | null): boolean {
  return displayMode === "focused";
}

/** Client-side read of display mode injected by root layout. */
export function readClientDisplayMode(): DisplayMode | null {
  if (typeof window === "undefined") return null;
  const mode = window.__AHD_DISPLAY_MODE;
  return mode === "focused" || mode === "classic" ? mode : null;
}

/**
 * Client-side: chrome suppressed in focused mode or native app WebView.
 * Native app sets the focused cookie; UA fallback covers first paint.
 */
export function isChromeSuppressedClient(displayMode?: DisplayMode | null): boolean {
  if (isFocusedDisplayMode(displayMode)) return true;
  const fromWindow = readClientDisplayMode();
  if (isFocusedDisplayMode(fromWindow)) return true;
  if (typeof navigator !== "undefined" && isNativeAppUserAgent(navigator.userAgent)) {
    return true;
  }
  return false;
}
