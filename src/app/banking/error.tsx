"use client";

import { ErrorPageContent } from "@/components/ui";

export default function BankingError({
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
      title="Couldn't load banking"
      description="The banking page failed to load. This may be a temporary issue."
      logPrefix="Banking page error"
      navigationLinks={[{ href: "/dashboard", label: "Dashboard" }]}
    />
  );
}
