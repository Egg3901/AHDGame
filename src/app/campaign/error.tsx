"use client";

import { ErrorPageContent } from "@/components/ui";

export default function CampaignError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorPageContent
      error={error}
      reset={reset}
      description="The campaign page couldn't load. This may be a temporary issue."
      logPrefix="Campaign page error"
      navigationLinks={[
        { href: "/campaign", label: "Back to Campaign" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
