"use client";

import { useTranslations } from "next-intl";
import { getDiscordAvatarUrl } from "@/lib/discord";

interface DiscordBadgeProps {
  discordId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
  /** Use on profile banner: matches online pill (backdrop, readable on photos) */
  variant?: "inline" | "banner";
}

const bannerBase =
  "border-card-border/80 bg-card/90 text-foreground shadow-sm backdrop-blur-sm sm:px-3 sm:py-1";

export function DiscordBadge({
  discordId,
  discordUsername,
  discordAvatar,
  variant = "inline",
}: DiscordBadgeProps) {
  const t = useTranslations("profile.discord");
  const isBanner = variant === "banner";

  if (!discordId || !discordUsername) {
    return (
      <span
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] text-muted sm:text-xs ${
          isBanner ? bannerBase : "border-card-border bg-card-elevated px-3 py-1"
        }`}
      >
        <svg className="h-3.5 w-3.5 opacity-50" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
        {t("notLinked")}
      </span>
    );
  }

  const avatarUrl = getDiscordAvatarUrl(discordId, discordAvatar);

  return (
    <button
      type="button"
      onClick={() => {
        // best-effort copy; guard the promise so a Safari/denied clipboard
        // rejection doesn't surface as an unhandled rejection in GlitchTip.
        void navigator.clipboard.writeText(discordUsername).catch(() => {});
      }}
      className={
        isBanner
          ? `inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-card sm:px-3 sm:py-1 sm:text-xs ${bannerBase}`
          : "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#5865F2]/30 bg-[#5865F2]/10 px-3 py-1 text-xs font-medium text-[#5865F2] transition-colors hover:bg-[#5865F2]/20"
      }
      title={t("copyUsername")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatarUrl} alt="" className="h-4 w-4 rounded-full" />
      {discordUsername}
    </button>
  );
}
