"use client";

import { ErrorPageContent } from "@/components/ui";

export default function AdminError({
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
      title="Couldn't load admin panel"
      description="The admin panel failed to load. This may be a temporary issue."
      logPrefix="Admin page error"
      navigationLinks={[{ href: "/dashboard", label: "Back to Dashboard" }]}
    />
  );
}
