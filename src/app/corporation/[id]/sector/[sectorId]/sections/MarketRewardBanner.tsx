"use client";

import { useState, useSyncExternalStore } from "react";

// Bump the version suffix if the message materially changes, so a previously
// dismissed banner re-appears for the new information.
const DISMISS_KEY = "ahd-market-onboarding-v1";

const noopSubscribe = () => () => {};
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false; // storage blocked (private mode) — show once, best effort
  }
}

interface MarketRewardBannerProps {
  hasPricing: boolean;
  hasCapital: boolean;
}

/**
 * One-time, dismissable heads-up shown on a sector page when the clearing
 * ("pricing") and/or capital tiers go live. Players otherwise have to discover
 * the new Pricing / Capital panels on their own — this flags that pricing and
 * capacity are now decisions they control. Dismissal is remembered in
 * localStorage so it never nags twice.
 */
export default function MarketRewardBanner({ hasPricing, hasCapital }: MarketRewardBannerProps) {
  // useSyncExternalStore reads localStorage SSR-safely: the server snapshot is
  // "dismissed" so a returning player never sees a flash, and the client reveals
  // the banner only when it wasn't previously dismissed. No mount effect needed.
  const storedDismissed = useSyncExternalStore(noopSubscribe, readDismissed, () => true);
  const [dismissed, setDismissed] = useState(false);

  if (storedDismissed || dismissed || (!hasPricing && !hasCapital)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — dismissal just won't persist */
    }
  };

  const what =
    hasPricing && hasCapital
      ? "You now set your own posted prices and manage each sector's productive capacity."
      : hasPricing
        ? "You now set your own posted price on each sector — demand fills the cheapest sellers first."
        : "Each sector now owns productive capacity that depreciates — your growth budget is investment.";

  return (
    <div className="relative rounded-xl border border-primary/30 bg-primary/5 p-4 pr-10">
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-base leading-none">
          📣
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">The market just got deeper</p>
          <p className="mt-0.5 text-xs text-muted">
            {what} Look for the{" "}
            {hasPricing && <span className="font-medium text-foreground">Pricing Posture</span>}
            {hasPricing && hasCapital && " and "}
            {hasCapital && (
              <span className="font-medium text-foreground">Capital &amp; Unit Economics</span>
            )}{" "}
            {hasPricing && hasCapital ? "panels" : "panel"} below. Figures fill in after the next
            turn.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-card hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}
