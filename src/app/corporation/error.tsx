"use client";

import { ErrorPageContent } from "@/components/ui";

export default function CorporationError({
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
      title="Couldn't load corporation"
      description="This corporation page failed to load. This may be a temporary issue."
      logPrefix="Corporation page error"
      navigationLinks={[
        { href: "/corporations", label: "All corporations" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
