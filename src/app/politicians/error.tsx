"use client";

import { ErrorPageContent } from "@/components/ui";

export default function PoliticiansError({
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
      description="The politicians page couldn't load. This may be a temporary issue."
      logPrefix="Politicians page error"
      navigationLinks={[
        { href: "/politicians", label: "Back to Politicians" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
