"use client";

import { ErrorPageContent } from "@/components/ui";

export default function SectorsError({
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
      title="Couldn't load sectors"
      description="The sectors page failed to load. This may be a temporary issue."
      logPrefix="Sectors page error"
      navigationLinks={[{ href: "/dashboard", label: "Dashboard" }]}
    />
  );
}
