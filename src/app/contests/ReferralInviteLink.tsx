"use client";

import { useState } from "react";

interface ReferralInviteLinkProps {
  userId: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
}

export function ReferralInviteLink({
  userId,
  label,
  copyLabel,
  copiedLabel,
}: ReferralInviteLinkProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const link = `${window.location.origin}/register?ref=${userId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mt-4">
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-card-border bg-card-elevated px-3 py-2 font-mono text-xs text-foreground select-all">
          /register?ref={userId}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            copied
              ? "border-success/40 bg-success/10 text-success"
              : "border-card-border bg-card text-foreground hover:bg-card-elevated"
          }`}
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
    </div>
  );
}
