"use client";

import { ErrorPageContent } from "@/components/ui";

export default function CountryPoliticiansError({
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
      title="Couldn't load politicians"
      description="The politicians page failed to load. This may be a temporary issue."
      logPrefix="Country politicians error"
      navigationLinks={[{ href: "/map", label: "View map" }]}
      fullScreen
    />
  );
}
