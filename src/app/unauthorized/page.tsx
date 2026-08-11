"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";

function UnauthorizedContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") || "You do not have permission to access this page";
  const returnUrl = searchParams.get("returnUrl") || "/";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="max-w-lg w-full">
        {/* Main unauthorized card */}
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-8 text-center space-y-6">
          {/* Lock icon */}
          <div className="flex justify-center">
            <div className="rounded-full bg-warning/20 p-4">
              <svg
                className="w-12 h-12 text-warning"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-3">
              <div className="h-px flex-1 bg-card-border" />
              <h1 className="text-6xl font-black tabular-nums text-warning">403</h1>
              <div className="h-px flex-1 bg-card-border" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
          </div>

          {/* Reason */}
          <div className="rounded-lg border border-card-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Reason</p>
            <p className="text-sm text-foreground">{reason}</p>
          </div>

          {/* Political flavor text */}
          <div className="pt-2">
            <p className="text-xs text-muted/70">
              This section of the capitol is{" "}
              <span className="font-semibold text-foreground">restricted</span>. You may need
              special clearance or administrator privileges.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link
              href={returnUrl}
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              Go Back
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-card-border bg-card px-6 py-2.5 text-sm font-semibold text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
            >
              Return Home
            </Link>
          </div>
        </div>

        {/* Common restricted areas */}
        <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            Common Reasons
          </h3>
          <ul className="space-y-2 text-xs text-muted">
            <li className="flex items-start gap-2">
              <span className="text-warning shrink-0">•</span>
              <span>Admin panel requires administrator privileges</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-warning shrink-0">•</span>
              <span>Some actions require you to have an active character</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-warning shrink-0">•</span>
              <span>Session may have expired - try logging out and back in</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function UnauthorizedPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Skeleton className="h-4 w-32" />
        </div>
      }
    >
      <UnauthorizedContent />
    </Suspense>
  );
}
