"use client";

import { ErrorPageContent } from "@/components/ui";

export default function ProfileError({
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
      title="Couldn't load profile"
      description="Your profile failed to load. This may be a temporary issue."
      logPrefix="Profile page error"
      navigationLinks={[{ href: "/dashboard", label: "Dashboard" }]}
    />
  );
}
