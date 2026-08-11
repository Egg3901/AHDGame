"use client";

import Link from "next/link";

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

const ERROR_COPY: Record<PageErrorCode, { headline: string; flavor: string; subtext: string }> = {
  401: {
    headline: "Session Expired",
    flavor: "Your credentials have been \u201Cvoted out\u201D.",
    subtext: "Log in again to resume your political career.",
  },
  403: {
    headline: "Access Denied",
    flavor: "This page has been \u201Cfilibustered\u201D \u2014 you lack the votes to enter.",
    subtext: "You don\u2019t have the clearance required to view this content.",
  },
  404: {
    headline: "Page Not Found",
    flavor:
      "This page has been \u201Cimpeached\u201D, \u201Cfilibustered\u201D, or simply never existed.",
    subtext: "The congressional record shows no evidence of this URL.",
  },
  429: {
    headline: "Too Many Requests",
    flavor: "The clerk\u2019s office is overwhelmed \u2014 you hit a rate limit.",
    subtext:
      "Wait a bit and try again. This is usually temporary and does not mean you were signed out.",
  },
  500: {
    headline: "Server Error",
    flavor: "A \u201Clegislative gridlock\u201D has brought the server to a standstill.",
    subtext: "Something went wrong on our end. Try again in a moment.",
  },
  network: {
    headline: "Connection Lost",
    flavor: "Your dispatch got lost \u201Cin committee\u201D.",
    subtext: "Check your connection and try again.",
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
            <p className="text-sm text-foreground/80 font-medium">{copy.flavor}</p>
            <p className="text-xs text-muted">{copy.subtext}</p>
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
