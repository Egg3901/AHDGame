"use client";

import { ErrorPageContent } from "@/components/ui";

export default function WikiError({
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
      title="Couldn't load the wiki"
      description="The wiki page failed to load. This may be a temporary issue."
      logPrefix="Wiki page error"
      navigationLinks={[{ href: "/wiki", label: "Wiki home" }]}
    />
  );
}
