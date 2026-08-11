"use client";

import { ErrorPageContent } from "@/components/ui";

export default function BondError({
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
      title="Couldn't load bond"
      description="This bond page failed to load. This may be a temporary issue."
      logPrefix="Bond page error"
      navigationLinks={[
        { href: "/portfolio", label: "Back to Portfolio" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
