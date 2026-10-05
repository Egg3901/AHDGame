"use client";

import { ErrorPageContent } from "@/components/ui";

export default function PoliticalOperationsError({
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
      title="Couldn't load political operations"
      description="This page failed to load. This may be a temporary issue."
      logPrefix="Political operations page error"
      navigationLinks={[{ href: "/dashboard", label: "Dashboard" }]}
    />
  );
}
