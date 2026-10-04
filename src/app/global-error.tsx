"use client";

import Link from "next/link";
import { ErrorRef } from "@/components/ui/ErrorRef";
import { useReportedError } from "@/lib/errors/useReportedError";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reported = useReportedError(error, {
    logPrefix: "Global error",
    codeOverride: "CRITICAL_ERROR",
  });

  return (
    <html>
      <body>
        <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
          <div className="max-w-md w-full space-y-4 text-center">
            <h1 className="text-2xl font-bold text-foreground">The app could not load</h1>
            <p className="text-sm text-muted">{reported.message}</p>
            <p className="font-mono text-xs text-muted" data-testid="error-code">
              {reported.code}
            </p>
            <ErrorRef code={reported.ref} label="Ref" />
            <p className="text-xs text-muted">
              If it keeps happening, report it with the code and ref above.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
              <button
                onClick={reset}
                className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                Try again
              </button>
              <Link
                href="/"
                className="rounded-lg border border-card-border px-6 py-2.5 text-sm font-semibold text-muted hover:text-foreground transition-colors"
              >
                Home
              </Link>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
