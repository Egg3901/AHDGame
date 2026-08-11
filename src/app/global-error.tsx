"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorRef } from "@/components/ui/ErrorRef";
import { captureClientException } from "@/lib/observability/sentryClientLazy";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureClientException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
          <div className="max-w-lg w-full">
            {/* Critical error card */}
            <div className="rounded-xl border-2 border-error bg-error/10 p-8 text-center space-y-6">
              {/* Error icon */}
              <div className="flex justify-center">
                <div className="rounded-full bg-error/20 p-4">
                  <svg
                    className="w-12 h-12 text-error"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
              </div>

              {/* Title */}
              <div className="space-y-2">
                <h1 className="text-3xl font-bold text-error">Critical Error</h1>
                <p className="text-sm text-muted">
                  The application encountered a catastrophic error and cannot continue.
                </p>
              </div>

              {/* Error details */}
              {error.message && (
                <div className="rounded-lg border border-card-border bg-card p-4 text-left">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                    Error Details
                  </p>
                  <p className="text-xs font-mono text-foreground break-all">{error.message}</p>
                  {error.digest && (
                    <div className="mt-2">
                      <ErrorRef error={error} />
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                <button
                  onClick={reset}
                  className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                >
                  Try Again
                </button>
                <Link
                  href="/"
                  className="rounded-lg border border-card-border bg-card px-6 py-2.5 text-sm font-semibold text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
                >
                  Go Home
                </Link>
              </div>
            </div>

            {/* Help text */}
            <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                What To Do
              </h2>
              <ul className="space-y-1 text-xs text-muted list-disc list-inside">
                <li>Try refreshing the page or clicking &quot;Try Again&quot;</li>
                <li>Clear your browser cache and cookies</li>
                <li>If the problem persists, report it on GitHub</li>
                <li>Check the browser console for more details</li>
              </ul>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
