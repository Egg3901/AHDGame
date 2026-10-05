"use client";

import Link from "next/link";
import type { ErrorCode } from "@/lib/errors/catalog";

export type PageErrorCode = 401 | 403 | 404 | 429 | 500 | "network";

interface PageErrorProps {
  code?: PageErrorCode;
  /** Raw error message shown only to admins */
  adminDetail?: string | null;
  isAdmin?: boolean;
  /** Override the default action buttons */
  backHref?: string;
  backLabel?: string;
}

const ERROR_COPY: Record<
  PageErrorCode,
  { headline: string; subtext: string; catalogCode: ErrorCode }
> = {
  401: {
    headline: "Session expired",
    subtext: "Log in again to pick up where you left off.",
    catalogCode: "UNAUTHORIZED",
  },
  403: {
    headline: "Access denied",
    subtext: "You do not have the clearance required to view this content.",
    catalogCode: "FORBIDDEN",
  },
  404: {
    headline: "Page not found",
    subtext: "There is nothing at this address.",
    catalogCode: "NOT_FOUND",
  },
  429: {
    headline: "Too many requests",
    subtext: "Wait a moment and try again. This does not mean you were signed out.",
    catalogCode: "RATE_LIMITED",
  },
  500: {
    headline: "Server error",
    subtext: "Something went wrong on our end. Try again in a moment.",
    catalogCode: "INTERNAL_ERROR",
  },
  network: {
    headline: "Connection lost",
    subtext: "Check your connection and try again.",
    catalogCode: "NETWORK_ERROR",
  },
};

export function PageError({
  code = 500,
  adminDetail,
  isAdmin = false,
  backHref = "/actions",
  backLabel = "Back to Actions",
}: PageErrorProps) {
  const copy = ERROR_COPY[code];
  const codeLabel = typeof code === "number" ? String(code) : code.toUpperCase();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="max-w-lg w-full space-y-4">
        <div className="rounded-xl border border-card-border bg-card p-8 text-center space-y-5">
          {/* Code badge */}
          <div className="flex items-center justify-center gap-3">
            <div className="h-px flex-1 bg-card-border" />
            <span className="text-5xl font-black tabular-nums text-foreground">{codeLabel}</span>
            <div className="h-px flex-1 bg-card-border" />
          </div>

          {/* Headlines */}
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-foreground">{copy.headline}</h1>
            <p className="text-sm text-muted">{copy.subtext}</p>
            <p className="font-mono text-xs text-muted" data-testid="error-code">
              {copy.catalogCode}
            </p>
          </div>

          {/* Admin detail */}
          {isAdmin && adminDetail && (
            <details className="text-left rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-2">
              <summary className="text-xs font-semibold text-yellow-400 cursor-pointer select-none">
                Admin: error detail
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-yellow-300/80 font-mono">
                {adminDetail}
              </pre>
            </details>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3 justify-center pt-1">
            <Link
              href={backHref}
              className="rounded-lg border border-card-border px-5 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              {backLabel}
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
