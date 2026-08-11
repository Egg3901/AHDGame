"use client";

import { useState } from "react";

interface ReferralsSectionProps {
  userId: string;
  referralCount: number;
}

export function ReferralsSection({ userId, referralCount }: ReferralsSectionProps) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  function flash(kind: "code" | "link") {
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleCopyCode() {
    navigator.clipboard.writeText(userId).then(() => flash("code"));
  }

  function handleCopyLink() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${origin}/register?ref=${userId}`;
    navigator.clipboard.writeText(link).then(() => flash("link"));
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted leading-relaxed">
        Share your invite link or code with friends. When they register and create a character, they
        start with a <strong className="text-foreground">10% stat bonus</strong>,{" "}
        <strong className="text-foreground">+10 actions</strong>, and{" "}
        <strong className="text-foreground">$500,000</strong> personal capital. You&apos;ll receive{" "}
        <strong className="text-foreground">+10 actions</strong> and{" "}
        <strong className="text-foreground">$500,000</strong> personal capital for each successful
        referral.
      </p>

      {/* Invite link — preferred share path; pre-fills referral on /register */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted uppercase tracking-wider">
          Your Invite Link
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-card-border bg-card-elevated px-4 py-2.5 font-mono text-sm text-foreground tracking-wider select-all">
            /register?ref={userId}
          </code>
          <button
            type="button"
            onClick={handleCopyLink}
            className={`shrink-0 inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
              copied === "link"
                ? "border-success/40 bg-success/10 text-success"
                : "border-card-border bg-card hover:bg-card-elevated text-foreground"
            }`}
          >
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      {/* Code display */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted uppercase tracking-wider">
          Your Referral Code
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-card-border bg-card-elevated px-4 py-2.5 font-mono text-sm text-foreground tracking-wider select-all">
            {userId}
          </code>
          <button
            type="button"
            onClick={handleCopyCode}
            className={`shrink-0 inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
              copied === "code"
                ? "border-success/40 bg-success/10 text-success"
                : "border-card-border bg-card hover:bg-card-elevated text-foreground"
            }`}
          >
            {copied === "code" ? (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="rounded-xl border border-card-border bg-card-elevated/50 px-5 py-4 flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{referralCount}</p>
          <p className="text-xs text-muted">
            player{referralCount !== 1 ? "s" : ""} joined with your code
          </p>
        </div>
      </div>
    </div>
  );
}
