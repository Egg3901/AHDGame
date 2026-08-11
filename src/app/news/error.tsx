"use client";

import { ErrorPageContent } from "@/components/ui";

export default function NewsError({
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
      description="The news page couldn't load. This may be a temporary issue."
      logPrefix="News page error"
      navigationLinks={[
        { href: "/news", label: "Back to News" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
