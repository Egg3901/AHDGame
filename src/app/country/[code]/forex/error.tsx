"use client";

import { ErrorPageContent } from "@/components/ui";

export default function CountryForexError({
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
      logPrefix="Country forex error"
      navigationLinks={[{ href: "/map", label: "View map" }]}
      fullScreen
    />
  );
}
