"use client";

/**
 * Full-page centered loading spinner.
 * Used during initial data fetches on client-rendered pages.
 */
export function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <svg className="h-8 w-8 animate-spin text-muted" fill="none" viewBox="0 0 24 24">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    </div>
  );
}
