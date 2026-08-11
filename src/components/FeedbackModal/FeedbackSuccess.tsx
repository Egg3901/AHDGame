"use client";

import Link from "next/link";

interface FeedbackSuccessProps {
  issueNumber: number | null;
  githubUrl: string | null;
  variant?: "bug" | "suggestion";
}

export function FeedbackSuccess({
  issueNumber,
  githubUrl,
  variant = "suggestion",
}: FeedbackSuccessProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20">
        <svg
          className="h-8 w-8 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="text-lg font-medium text-foreground">Thank you!</p>
      <p className="mt-1 text-sm text-muted">
        {variant === "bug"
          ? "Your bug report has been submitted."
          : "Your suggestion has been submitted."}
      </p>
      {issueNumber != null && (
        <>
          <p className="mt-3 font-mono text-sm text-primary">
            {variant === "bug" ? `#${issueNumber}` : `S#${issueNumber}`}
          </p>
          {variant === "suggestion" ? (
            <Link
              href={`/feedback/${issueNumber}`}
              className="mt-3 text-sm font-medium text-primary hover:underline"
            >
              View on the suggestions board
            </Link>
          ) : null}
        </>
      )}
      {githubUrl ? (
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          View on GitHub
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      ) : null}
    </div>
  );
}
