"use client";

import Link from "next/link";
import { ErrorRef } from "@/components/ui/ErrorRef";
import { useReportedError } from "@/lib/errors/useReportedError";

interface NavigationLink {
  href: string;
  label: string;
  primary?: boolean;
}

interface ErrorPageContentProps {
  /** Error object from Next.js error boundary */
  error: Error & { digest?: string };
  /** Reset function from Next.js error boundary */
  reset: () => void;
  /** Title shown in the error UI */
  title?: string;
  /** Description shown below the title */
  description?: string;
  /** Log prefix for console.error (e.g., "Dashboard error") */
  logPrefix?: string;
  /** Navigation links to show (defaults to Dashboard) */
  navigationLinks?: NavigationLink[];
  /** Use min-h-screen (true) or min-h-[50vh] (false) */
  fullScreen?: boolean;
}

/**
 * Reusable error content for Next.js error.tsx pages.
 * Handles logging and provides consistent error UI.
 *
 * @example
 * export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
 *   return (
 *     <ErrorPageContent
 *       error={error}
 *       reset={reset}
 *       title="Couldn't load dashboard"
 *       description="Your dashboard failed to load. This may be a temporary issue."
 *       logPrefix="Dashboard error"
 *       navigationLinks={[{ href: "/", label: "Go home" }]}
 *     />
 *   );
 * }
 */
export function ErrorPageContent({
  error,
  reset,
  title = "Something went wrong",
  description = "An unexpected error occurred. This may be a temporary issue.",
  logPrefix = "Page error",
  navigationLinks = [{ href: "/dashboard", label: "Dashboard" }],
  fullScreen = false,
}: ErrorPageContentProps) {
  const reported = useReportedError(error, { logPrefix });
  const links = navigationLinks.some((l) => l.href === "/")
    ? navigationLinks
    : [...navigationLinks, { href: "/", label: "Home" }];

  const heightClass = fullScreen ? "min-h-screen" : "min-h-[50vh]";

  return (
    <div
      className={`${heightClass} bg-background flex flex-col items-center justify-center px-6 py-12`}
    >
      <div className="rounded-xl border border-card-border bg-card p-8 max-w-md text-center space-y-4">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted">{description}</p>
        <p className="font-mono text-xs text-muted" data-testid="error-code">
          {reported.code}
        </p>
        <ErrorRef code={reported.ref} label="Ref" />
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            onClick={reset}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                link.primary
                  ? "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
                  : "rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
              }
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
