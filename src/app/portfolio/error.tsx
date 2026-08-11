"use client";

import { ErrorPageContent } from "@/components/ui";

export default function PortfolioError({
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
      description="The portfolio couldn't load. This may be a temporary issue."
      logPrefix="Portfolio page error"
      navigationLinks={[
        { href: "/portfolio", label: "Back to Portfolio" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
