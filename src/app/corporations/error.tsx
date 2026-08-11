"use client";

import { ErrorPageContent } from "@/components/ui";

export default function CorporationsError({
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
      description="The corporations page couldn't load. This may be a temporary issue."
      logPrefix="Corporations page error"
      navigationLinks={[
        { href: "/corporations", label: "Back to Corporations" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
