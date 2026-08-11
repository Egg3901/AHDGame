"use client";

import { ErrorPageContent } from "@/components/ui";

export default function OfficialsError({
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
      description="The officials page couldn't load. This may be a temporary issue."
      logPrefix="Officials page error"
      navigationLinks={[
        { href: "/officials", label: "Back to Officials" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
