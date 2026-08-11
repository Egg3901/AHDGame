"use client";

import { ErrorPageContent } from "@/components/ui";

export default function NationalBudgetError({
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
      title="Couldn't load national budget"
      description="The national budget page failed to load. This may be a temporary issue."
      logPrefix="National budget error"
      navigationLinks={[{ href: "/map", label: "View map" }]}
      fullScreen
    />
  );
}
