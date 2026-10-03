import { useTranslations } from "next-intl";
import { getOnlineStatus } from "@/lib/utils/onlineStatus";
import { DiscordBadge } from "../DiscordBadge";
import { SectionHeader } from "./ProfileMeters";

/** Discord link and last-seen status, shared by the own and public profile. */
export function ProfileSocial({
  discordId,
  discordUsername,
  discordAvatar,
  lastActivity,
}: {
  discordId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
  lastActivity: Date | null;
}) {
  const t = useTranslations("profile.social");
  if (!discordId && !lastActivity) return null;
  const online = lastActivity ? getOnlineStatus(lastActivity) : null;

  return (
    <section>
      <SectionHeader level="aside">{t("title")}</SectionHeader>
      <div className="flex flex-wrap items-center gap-3">
        {discordId && (
          <DiscordBadge
            discordId={discordId}
            discordUsername={discordUsername}
            discordAvatar={discordAvatar}
          />
        )}
        {online && (
          <span className="inline-flex items-center gap-2 text-body-sm text-muted">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${online.isOnline ? "bg-foreground" : "bg-muted/60"}`}
            />
            {online.text}
          </span>
        )}
      </div>
    </section>
  );
}
