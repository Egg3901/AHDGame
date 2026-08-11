"use client";

import { ErrorPageContent } from "@/components/ui";

export default function NotificationsError({
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
      title="Couldn't load notifications"
      description="Your notifications failed to load. This may be a temporary issue."
      logPrefix="Notifications page error"
      navigationLinks={[{ href: "/dashboard", label: "Dashboard" }]}
      fullScreen
    />
  );
}
