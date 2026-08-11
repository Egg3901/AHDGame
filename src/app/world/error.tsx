"use client";

import { ErrorPageContent } from "@/components/ui";

export default function WorldError({
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
      description="The world page couldn't load. This may be a temporary issue."
      logPrefix="World page error"
      navigationLinks={[
        { href: "/world", label: "Back to World" },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      fullScreen
    />
  );
}
