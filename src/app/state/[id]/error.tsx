"use client";

import { ErrorPageContent } from "@/components/ui";

export default function StateError({
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
      title="Couldn't load state"
      description="This state page failed to load. This may be a temporary issue."
      logPrefix="State page error"
      navigationLinks={[{ href: "/map", label: "View map" }]}
    />
  );
}
