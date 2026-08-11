"use client";

import { ErrorPageContent } from "@/components/ui";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const msg = typeof error?.message === "string" ? error.message : "";
  const looksLikeNetwork =
    /failed to fetch|networkerror|load failed|fetch.*(failed|aborted)|terminated/i.test(msg);

  return (
    <ErrorPageContent
      error={error}
      reset={reset}
      logPrefix="App error"
      title={looksLikeNetwork ? "Could not reach the server" : undefined}
      description={
        looksLikeNetwork
          ? "Your browser could not complete a request. Check your connection and try again. This is usually temporary and does not mean you were signed out."
          : undefined
      }
      navigationLinks={[{ href: "/", label: "Go home" }]}
      fullScreen
    />
  );
}
