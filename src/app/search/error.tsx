"use client";

import { ErrorPageContent } from "@/components/ui";

export default function SearchError({
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
      title="Couldn't load search"
      description="Search failed to load. This may be a temporary issue."
      logPrefix="Search page error"
      navigationLinks={[{ href: "/dashboard", label: "Dashboard" }]}
    />
  );
}
