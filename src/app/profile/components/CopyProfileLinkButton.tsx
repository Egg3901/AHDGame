"use client";

import { useState } from "react";

interface Props {
  href: string;
}

export function CopyProfileLinkButton({ href }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const url = `${window.location.origin}${href}`;
    // Guard the clipboard promise: Safari (and any non-user-activated context)
    // rejects writeText, and an un-caught rejection surfaces as an
    // "UnhandledRejection ... value: undefined" in GlitchTip. Swallow the
    // failure — copying is best-effort UI sugar.
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        /* clipboard unavailable / denied — no-op */
      });
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy profile link"
      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-card-border bg-card-elevated px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-card-border/50 hover:text-primary transition-all"
    >
      {copied ? (
        <>
          <svg
            className="h-3.5 w-3.5 text-success"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-success">Copied!</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          Share
        </>
      )}
    </button>
  );
}
