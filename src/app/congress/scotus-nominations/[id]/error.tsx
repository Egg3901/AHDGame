"use client";

import { ErrorPageContent } from "@/components/ui";

export default function ScotusNominationError({
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
      description="The Supreme Court nomination page couldn't load. This may be a temporary issue."
      logPrefix="SCOTUS nomination page error"
      navigationLinks={[
        { href: "/congress?chamber=senate&tab=bills", label: "Back to Senate Bills" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
