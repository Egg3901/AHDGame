"use client";

import { useEffect } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";

/**
 * Invisible page-visit tracker for the two client-recorded onboarding steps.
 * Server pages render it only when the flag is on, the viewer has a character,
 * and the step is still unrecorded, so it fires at most one PATCH per visit
 * and stops rendering entirely once the step is stored (the server stamps the
 * timestamp and ignores repeats).
 */
export function OnboardingStepTracker({ step }: { step: "scout-state" | "read-wire" }) {
  useEffect(() => {
    // Best-effort tracking: never surface an error for this. fetchJson still
    // reports network/5xx faults to GlitchTip tagged with the feature.
    void fetchJson("/api/character/me", {
      feature: "onboarding-step-tracker",
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingStep: step }),
    }).catch(() => undefined);
  }, [step]);

  return null;
}
