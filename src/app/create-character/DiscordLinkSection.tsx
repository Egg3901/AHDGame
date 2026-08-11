"use client";

import { useState, useCallback } from "react";
import Image from "next/image";

interface DiscordLinkSectionProps {
  /** Initial linked state from auth data. */
  initialLinked: boolean;
  /** Current user data to show linked status. */
  discordId?: string | undefined;
  discordUsername?: string | undefined;
  discordAvatar?: string | undefined;
}

function getDiscordAvatarUrl(discordId: string, avatarHash: string | null | undefined): string {
  if (avatarHash) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`;
  }
  const defaultIndex = Number(BigInt(discordId) % BigInt(5));
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

const DiscordIcon = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

export function DiscordLinkSection({
  initialLinked,
  discordId,
  discordUsername,
  discordAvatar,
}: DiscordLinkSectionProps) {
  const [linked, setLinked] = useState(initialLinked);
  const [polling, setPolling] = useState(false);

  // Poll auth/me after the user returns from the Discord OAuth flow.
  // The popup/tab opens /api/auth/discord?returnUrl=... which redirects
  // to Discord, then back to /auth/discord/result, which auto-redirects
  // back to the returnUrl. We detect completion by polling.
  const startPolling = useCallback(() => {
    setPolling(true);
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          if (data.user?.discordId) {
            setLinked(true);
            setPolling(false);
            clearInterval(interval);
            return;
          }
        }
      } catch {
        // ignore network errors during poll
      }
      if (attempts >= maxAttempts) {
        setPolling(false);
        clearInterval(interval);
      }
    }, 1000);
  }, []);

  const handleLink = () => {
    const returnUrl = window.location.pathname + window.location.search;
    const linkUrl = `/api/auth/discord?returnUrl=${encodeURIComponent(returnUrl)}`;
    // Open in a new tab so the user doesn't lose their form progress
    window.open(linkUrl, "_blank");
    startPolling();
  };

  const avatarUrl =
    linked && discordId ? getDiscordAvatarUrl(discordId, discordAvatar ?? undefined) : null;

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card">
      <div className="relative px-4 pt-3 pb-1">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-info/10 text-info">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
            </svg>
          </div>
          <h2 className="text-heading-sm font-semibold">Discord</h2>
        </div>
        <p className="ml-9 text-body-sm text-muted">
          Optional. Link now or later from your settings page.
        </p>
      </div>
      <div className="p-4 pt-3">
        <p className="mb-3 text-body-sm leading-relaxed text-muted">
          Most parties and nations coordinate strategy and alliances over Discord, so linking is
          recommended.
        </p>

        {linked ? (
          <div className="flex items-center gap-4 p-4 rounded-xl border border-card-border bg-card-elevated">
            {avatarUrl && (
              <Image
                src={avatarUrl}
                alt="Discord avatar"
                width={40}
                height={40}
                className="w-10 h-10 rounded-lg"
              />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{discordUsername ?? "Discord"}</p>
              <p className="text-xs text-muted">Discord account linked</p>
            </div>
            <span className="rounded-full bg-success/10 border border-success/20 px-3 py-1 text-[11px] font-medium text-success">
              Linked
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleLink}
              disabled={polling}
              className="inline-flex items-center gap-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              {DiscordIcon}
              {polling ? "Waiting for link..." : "Link Discord"}
            </button>
            {polling && (
              <p className="text-xs text-muted italic">
                Complete the authorization in the new tab, then return here.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
