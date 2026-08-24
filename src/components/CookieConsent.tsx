"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui";
import { shouldRenderGooglePrivacyMessaging } from "@/lib/googlePrivacyMessaging";

const STORAGE_KEY = "ahd-cookie-consent";
export const CONSENT_EVENT = "ahd:cookie-consent-changed";
export const CONSENT_RESET_EVENT = "ahd:cookie-consent-reset";

export type CookieConsentValue = "accepted" | "rejected";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    googlefc?: {
      callbackQueue?: Array<() => void>;
      showRevocationMessage?: () => void;
    };
  }
}

function applyFallbackGoogleConsent(choice: CookieConsentValue | null) {
  if (typeof window === "undefined") return;
  if (shouldRenderGooglePrivacyMessaging(window.location.pathname, window.location.hostname))
    return;
  if (!window.gtag) return;

  const state = choice === "accepted" ? "granted" : "denied";
  window.gtag("consent", "update", {
    ad_storage: state,
    analytics_storage: state,
    ad_user_data: state,
    ad_personalization: state,
  });
}

export function getStoredConsent(): CookieConsentValue | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    return null;
  }
}

export function openCookiePreferences() {
  if (typeof window === "undefined") return;

  if (shouldRenderGooglePrivacyMessaging(window.location.pathname, window.location.hostname)) {
    window.googlefc = window.googlefc || {};
    window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
    window.googlefc.callbackQueue.push(() => {
      window.googlefc?.showRevocationMessage?.();
    });
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable
  }
  applyFallbackGoogleConsent(null);
  window.dispatchEvent(new Event(CONSENT_RESET_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(CONSENT_EVENT, callback);
  window.addEventListener(CONSENT_RESET_EVENT, callback);
  return () => {
    window.removeEventListener(CONSENT_EVENT, callback);
    window.removeEventListener(CONSENT_RESET_EVENT, callback);
  };
}

// Sentinel: the SSR snapshot must equal the first client snapshot to avoid a
// hydration mismatch. We treat "unset" as "decision not yet read" — different
// from a deliberate null/rejected — and skip rendering until the post-commit
// snapshot resolves to a real value or null.
const UNSET = Symbol("unset");
type ConsentSnapshot = CookieConsentValue | null | typeof UNSET;

function getSnapshot(): ConsentSnapshot {
  return getStoredConsent();
}

function getServerSnapshot(): ConsentSnapshot {
  return UNSET;
}

function setConsent(choice: CookieConsentValue) {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // localStorage unavailable (private mode, quota) — still notify listeners
  }
  applyFallbackGoogleConsent(choice);
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
}

export function CookieConsentBanner() {
  const pathname = usePathname();
  const consent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const usesGoogleCmp =
    typeof window !== "undefined" &&
    shouldRenderGooglePrivacyMessaging(pathname, window.location.hostname);

  useEffect(() => {
    if (consent === UNSET) return;
    applyFallbackGoogleConsent(consent);
  }, [consent]);

  if (usesGoogleCmp) return null;

  if (consent === UNSET || consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[150] mx-auto max-w-3xl rounded-xl border border-card-border bg-card shadow-modal sm:inset-x-4 sm:bottom-[calc(5rem+env(safe-area-inset-bottom))]"
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex-1 text-sm text-muted leading-relaxed">
          <p className="mb-1 font-semibold text-foreground">We use cookies</p>
          <p>
            We use essential cookies to keep you signed in and the game running. We may also set an
            anonymous cookie for traffic analytics. You can reject non-essential cookies at any
            time. See our{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            onClick={() => setConsent("rejected")}
            aria-label="Reject non-essential cookies"
          >
            Reject
          </Button>
          <Button
            variant="primary"
            className="min-w-0 px-4"
            onClick={() => setConsent("accepted")}
            aria-label="Accept all cookies"
          >
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
