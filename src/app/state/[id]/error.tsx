"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorRef } from "@/components/ui/ErrorRef";

export default function StateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("State page error:", error);
  }, [error]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center px-6 py-12">
      <div className="rounded-2xl border border-card-border bg-card/80 backdrop-blur-sm p-8 max-w-md text-center space-y-4 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">Couldn&apos;t load state</h1>
        <p className="text-sm text-muted">
          This state page failed to load. There may be a temporary issue.
        </p>
        <ErrorRef error={error} />
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            onClick={reset}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/map"
            className="rounded-xl border border-card-border px-5 py-2.5 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            View map
          </Link>
        </div>
      </div>
    </div>
  );
}
