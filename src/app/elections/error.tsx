"use client";

import { ErrorPageContent } from "@/components/ui";

export default function ElectionsError({
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
      description="The elections page couldn't load. This may be a temporary issue."
      logPrefix="Elections page error"
      navigationLinks={[
        { href: "/elections", label: "Back to Elections" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
