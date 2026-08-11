"use client";

import { ErrorPageContent } from "@/components/ui";

export default function BudgetError({
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
      description="The budget page couldn't load. This may be a temporary issue."
      logPrefix="Budget page error"
      navigationLinks={[
        { href: "/budget", label: "Back to Budget" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
