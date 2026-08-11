"use client";

import { ErrorPageContent } from "@/components/ui";

export default function CountryPartiesError({
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
      title="Couldn't load parties"
      description="The parties page failed to load. This may be a temporary issue."
      logPrefix="Country parties error"
      navigationLinks={[{ href: "/map", label: "View map" }]}
      fullScreen
    />
  );
}
