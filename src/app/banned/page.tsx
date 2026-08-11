"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";

function BannedContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") || "Violation of rules";

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Main ban notice */}
        <div className="rounded-xl border-2 border-error bg-error/10 p-8 text-center space-y-6">
          {/* Ban icon */}
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
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                />
              </svg>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-error">Account Banned</h1>
            <p className="text-sm text-muted">Your account has been banned from A House Divided.</p>
          </div>

          {/* Reason box */}
          <div className="rounded-lg border border-card-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Reason</p>
            <p className="text-sm font-medium text-foreground">{reason}</p>
          </div>

          {/* Contact info */}
          <div className="pt-2">
            <p className="text-xs text-muted/70">
              If you believe this was a mistake, please contact an administrator through Discord or
              GitHub.
            </p>
          </div>
        </div>

        {/* Additional info card */}
        <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            What This Means
          </h2>
          <ul className="space-y-1 text-xs text-muted list-disc list-inside">
            <li>You cannot access your character or participate in the game</li>
            <li>Your profile and political career have been suspended</li>
            <li>Bans are typically permanent unless appealed successfully</li>
          </ul>
        </div>
      </div>
    </main>
  );
}

export default function BannedPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Skeleton className="h-4 w-32" />
        </div>
      }
    >
      <BannedContent />
    </Suspense>
  );
}
