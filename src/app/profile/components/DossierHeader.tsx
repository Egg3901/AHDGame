import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { PatreonTier, ProfileBorderKey, SupporterProvider } from "@/lib/db/types";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { ProfilePictureUpload } from "@/components/ProfilePictureUpload";
import { PatreonBadge } from "@/components/patreon/PatreonBadge";
import { CampaignSongPlayer } from "@/components/CampaignSongPlayer";
import { getPartyHex } from "@/lib/utils/politics";
import { regionUrl, partyUrl } from "@/lib/urls";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { CopyProfileLinkButton } from "./CopyProfileLinkButton";

interface DossierHeaderProps {
  character: Character;
  party: PoliticalParty | null;
  user: { isAdmin: boolean | undefined; isModerator: boolean | undefined };
  memberSince: string;
  officeLabels: readonly string[];
  stateLabel: string;
  countrySlug: string;
  patreonHighlightColor?: string | null;
  patreonTier?: PatreonTier;
  patreonExpiresAt?: Date | null;
  patreonSince?: Date | null;
  patreonProfileBorder?: ProfileBorderKey | null;
  supporterProvider?: SupporterProvider | null;
  ownProfileHref: string;
}

/**
 * Record variant of the own-profile header (experiment `profile-redesign`).
 * An identity block, not a banner: name, office, then the facts as one line
 * of text. Built from the same card, badge and button styles as the rest of
 * the site so it follows the active theme.
 */
export function DossierHeader({
  character,
  party,
  user,
  memberSince,
  officeLabels,
  stateLabel,
  countrySlug,
  patreonHighlightColor,
  patreonTier,
  patreonExpiresAt,
  patreonSince,
  patreonProfileBorder,
  supporterProvider,
  ownProfileHref,
}: DossierHeaderProps) {
  const t = useTranslations("profile");
  const partyHex = patreonHighlightColor ?? getPartyHex(character.party, party?.color ?? undefined);
  const countryId = (character.countryId ?? (countrySlug.toUpperCase() as CountryId)) as CountryId;
  const countryCfg = getCountryConfig(countryId);
  const isIndependent = character.party === "independent" || !party;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
      <div className="h-1.5" style={{ backgroundColor: partyHex }} />
      {character.profileHeaderImageUrl && (
        <div className="relative h-24 sm:h-36">
          <Image
            src={character.profileHeaderImageUrl}
            alt=""
            fill
            priority
            className="object-cover"
            sizes="(max-width: 1280px) 100vw, 1280px"
            unoptimized={bypassNextImageOptimization(character.profileHeaderImageUrl)}
          />
        </div>
      )}

      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:gap-6 sm:p-6">
        <div className="shrink-0">
          <ProfilePictureUpload
            currentUrl={character.avatarUrl}
            characterName={character.name}
            size="compact"
            hideHint
            borderKey={patreonProfileBorder}
            tintColor={patreonHighlightColor}
            patreonTier={patreonTier ?? null}
            patreonExpiresAt={patreonExpiresAt ?? null}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <h1 className="dossier-name text-foreground">{character.name}</h1>
              <p className="mt-1 text-sm font-medium text-foreground/80 sm:text-base">
                {officeLabels.length > 0 ? officeLabels.join(", ") : t("dossier.noOffice")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <CopyProfileLinkButton href={ownProfileHref} />
              <Link
                href="/settings"
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-card-border bg-card-elevated px-3 py-1.5 text-xs font-semibold text-foreground transition-all hover:bg-card-border/50 hover:text-primary"
              >
                {t("header.editProfile")}
              </Link>
            </div>
          </div>

          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {isIndependent ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                <span className="h-2 w-2 rounded-sm bg-muted" aria-hidden />
                {t("dossier.independent")}
              </span>
            ) : (
              <Link
                href={partyUrl(countrySlug, party.sequentialId)}
                className="inline-flex items-center gap-1.5 font-semibold transition-[filter] hover:brightness-110"
                style={{ color: partyHex }}
              >
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: partyHex }}
                  aria-hidden
                />
                {party.name}
              </Link>
            )}
            <span>
              <Link
                href={regionUrl(countryId, character.homeState)}
                className="transition-colors hover:text-primary"
              >
                {stateLabel}
              </Link>
              ,{" "}
              <Link href={countryCfg.overviewPath} className="transition-colors hover:text-primary">
                {countryCfg.name}
              </Link>
            </span>
            <span>{t("header.memberSince", { date: memberSince })}</span>
            {patreonTier && (
              <PatreonBadge
                tier={patreonTier}
                expiresAt={patreonExpiresAt}
                since={patreonSince}
                provider={supporterProvider ?? undefined}
              />
            )}
            {user.isAdmin && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                {t("header.admin")}
              </span>
            )}
            {user.isModerator && !user.isAdmin && (
              <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-info">
                {t("header.moderator")}
              </span>
            )}
          </p>

          {character.bio ? (
            <p className="mt-4 max-w-prose text-sm leading-relaxed text-foreground/85">
              {character.bio}
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted">{t("header.noBio")}</p>
          )}

          {character.campaignSongUrl && (
            <div className="mt-4 rounded-lg border border-card-border bg-card-elevated/40 p-3">
              <CampaignSongPlayer
                videoId={character.campaignSongUrl}
                characterName={character.name}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
