"use client";

import { ErrorPageContent } from "@/components/ui";

export default function DashboardError({
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
      description="The dashboard couldn't load. This may be a temporary issue."
      logPrefix="Dashboard page error"
      navigationLinks={[
        { href: "/dashboard", label: "Back to Dashboard" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
