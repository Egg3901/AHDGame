"use client";

import { ErrorPageContent } from "@/components/ui";

export default function ForexError({
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
      title="Couldn't load forex"
      description="The forex page failed to load. This may be a temporary issue."
      logPrefix="Forex page error"
      navigationLinks={[{ href: "/dashboard", label: "Dashboard" }]}
      fullScreen
    />
  );
}
