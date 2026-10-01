"use client";

import { useEffect, useState } from "react";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { CONSENT_EVENT, CONSENT_RESET_EVENT, getStoredConsent } from "@/components/CookieConsent";
import { getPostHogClient } from "./posthogClient";

type TelemetryFlag =
  | "onboarding-checklist"
  | "ask-upsell-placement"
  | "turn-complete-celebration"
  | "profile-redesign";

/**
 * Consent-gated assignment. Missing or unavailable flags always render control.
 * `assigned` is true only once PostHog has answered; a `ready` without it means
 * the fallback fired and `variant` is the default, not a real assignment.
 */
export function usePostHogVariant(flag: TelemetryFlag): {
  variant: "control" | "test";
  ready: boolean;
  assigned: boolean;
} {
  const { user } = useAuthMe();
  const userId = typeof user?.id === "string" ? user.id : null;
  const [variant, setVariant] = useState<"control" | "test">("control");
  const [ready, setReady] = useState(false);
  const [assigned, setAssigned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (fallback) clearTimeout(fallback);
      setAssigned(false);
      if (!userId || getStoredConsent() !== "accepted") {
        setVariant("control");
        setReady(true);
        return;
      }
      setReady(false);
      void getPostHogClient()
        .then((client) => {
          if (cancelled) return;
          if (!client || getStoredConsent() !== "accepted") {
            setVariant("control");
            setReady(true);
            return;
          }
          client.identify(userId);
          unsubscribe = client.onFeatureFlags(() => {
            if (!cancelled) {
              const assignment = client.getFeatureFlag(flag);
              setVariant(assignment === "test" || assignment === "b" ? "test" : "control");
              setAssigned(true);
              setReady(true);
            }
          });
          fallback = setTimeout(() => {
            if (!cancelled) setReady(true);
          }, 2000);
        })
        .catch(() => {
          if (!cancelled) {
            setVariant("control");
            setReady(true);
          }
        });
    };
    load();
    window.addEventListener(CONSENT_EVENT, load);
    window.addEventListener(CONSENT_RESET_EVENT, load);
    return () => {
      cancelled = true;
      if (fallback) clearTimeout(fallback);
      unsubscribe?.();
      window.removeEventListener(CONSENT_EVENT, load);
      window.removeEventListener(CONSENT_RESET_EVENT, load);
    };
  }, [flag, userId]);

  return { variant, ready, assigned };
}
