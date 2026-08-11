"use client";

import { normalizeDiscordInviteUrl } from "@/lib/discord/invite";

interface DiscordInviteButtonProps {
  inviteUrl?: string | null;
  entityName: string;
  className?: string;
}

export function DiscordInviteButton({
  inviteUrl,
  entityName,
  className = "",
}: DiscordInviteButtonProps) {
  const normalizedInviteUrl = normalizeDiscordInviteUrl(inviteUrl);

  if (normalizedInviteUrl) {
    return (
      <a
        href={normalizedInviteUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`${entityName} Discord server`}
        title={`Open ${entityName} Discord server`}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-secondary bg-secondary text-white shadow-sm transition-opacity hover:opacity-90 ${className}`.trim()}
      >
        <DiscordGlyph />
      </a>
    );
  }

  return (
    <span
      aria-disabled="true"
      title="No Discord link set"
      className={`flex h-10 w-10 shrink-0 cursor-not-allowed items-center justify-center rounded-full border border-card-border bg-background/50 text-muted/40 ${className}`.trim()}
    >
      <DiscordGlyph />
    </span>
  );
}

function DiscordGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369A19.791 19.791 0 0 0 15.885 3a13.66 13.66 0 0 0-.673 1.381 18.27 18.27 0 0 0-5.424 0A13.66 13.66 0 0 0 9.115 3a19.736 19.736 0 0 0-4.433 1.369C1.884 8.583 1.13 12.693 1.507 16.746a19.9 19.9 0 0 0 5.423 2.746 14.26 14.26 0 0 0 1.162-1.905 12.94 12.94 0 0 1-1.83-.873c.154-.112.304-.23.45-.352a14.113 14.113 0 0 0 12.576 0c.147.122.297.24.451.352-.586.34-1.198.632-1.831.873.33.67.719 1.307 1.161 1.905a19.864 19.864 0 0 0 5.424-2.746c.442-4.699-.756-8.771-3.176-12.377ZM8.02 14.323c-1.227 0-2.236-1.12-2.236-2.495 0-1.375.99-2.495 2.236-2.495 1.255 0 2.255 1.13 2.236 2.495 0 1.375-.99 2.495-2.236 2.495Zm7.96 0c-1.227 0-2.236-1.12-2.236-2.495 0-1.375.99-2.495 2.236-2.495 1.255 0 2.255 1.13 2.236 2.495 0 1.375-.981 2.495-2.236 2.495Z" />
    </svg>
  );
}
