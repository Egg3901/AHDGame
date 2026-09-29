"use client";

import { usePostHogVariant } from "@/lib/analytics/usePostHogVariant";
import { NewPlayerBanner } from "./OnboardingCard";
import { OnboardingChecklist, type OnboardingChecklistProps } from "./OnboardingChecklist";

/** The existing banner is control; the checklist is the assigned treatment. */
export function OnboardingFlaggedCard({
  checklist,
  bannerDismissed,
}: {
  checklist: OnboardingChecklistProps | null;
  bannerDismissed: boolean;
}) {
  const { variant } = usePostHogVariant("onboarding-checklist");
  if (variant === "test" && checklist) return <OnboardingChecklist {...checklist} />;
  return bannerDismissed ? null : <NewPlayerBanner />;
}
