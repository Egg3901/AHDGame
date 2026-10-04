"use client";

import { ErrorPageContent } from "@/components/ui";

export default function StatePartyError({
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
      title="Couldn't load state party"
      description="This state party page failed to load, for example the Treasury tab hit a display error. Try again or return to the map."
      logPrefix="State party page error"
      navigationLinks={[{ href: "/map", label: "View map" }]}
    />
  );
}
