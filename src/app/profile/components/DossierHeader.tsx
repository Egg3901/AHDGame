import Link from "next/link";
import Image from "next/image";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { PatreonTier, ProfileBorderKey, SupporterProvider } from "@/lib/db/types";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { ProfilePictureUpload } from "@/components/ProfilePictureUpload";
import { PatreonBadge } from "@/components/patreon/PatreonBadge";
import { CampaignSongPlayer } from "@/components/CampaignSongPlayer";
import { CountryFlag } from "@/components/CountryFlag";
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
 * Dossier variant of the own-profile header (experiment `profile-redesign`).
 * Office and name are the headline, party and place are typography rather than
 * chips, and the party colour is the only accent. Designed to stand on its own
 * with no banner or avatar uploaded.
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
  const accentHex =
    patreonHighlightColor ?? getPartyHex(character.party, party?.color ?? undefined);
  const countryId = (character.countryId ?? (countrySlug.toUpperCase() as CountryId)) as CountryId;
  const countryCfg = getCountryConfig(countryId);
  const isIndependent = character.party === "independent" || !party;
  const [primaryOffice, ...otherOffices] = officeLabels;
  const fileNumber = character.sequentialId
    ? `${countryCfg.code.toUpperCase()}-${String(character.sequentialId).padStart(5, "0")}`
    : countryCfg.code.toUpperCase();

  return (
    <section
      className="dossier-hero relative overflow-hidden rounded-xl border border-card-border bg-card"
      style={{ "--dossier-party": accentHex } as CSSProperties}
    >
      {character.profileHeaderImageUrl ? (
        <div className="relative h-28 sm:h-40">
          <Image
            src={character.profileHeaderImageUrl}
            alt=""
            fill
            priority
            className="object-cover"
            sizes="(max-width: 1280px) 100vw, 1280px"
            unoptimized={bypassNextImageOptimization(character.profileHeaderImageUrl)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
        </div>
      ) : (
        <div className="dossier-hero-field" aria-hidden />
      )}

      <div className="relative px-5 pb-6 pt-5 sm:px-8 sm:pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="dossier-meta">
            <span>{t("dossier.file")}</span>
            <span aria-hidden>/</span>
            <span>{fileNumber}</span>
            <span aria-hidden>/</span>
            <span>{t("header.memberSince", { date: memberSince })}</span>
          </p>
          <div className="dossier-actions flex items-center gap-2">
            <CopyProfileLinkButton href={ownProfileHref} />
            <Link href="/settings" className="dossier-button">
              {t("header.editProfile")}
            </Link>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-7">
          <div className="dossier-avatar shrink-0">
            <ProfilePictureUpload
              currentUrl={character.avatarUrl}
              characterName={character.name}
              size="hero"
              borderKey={patreonProfileBorder}
              tintColor={patreonHighlightColor}
              patreonTier={patreonTier ?? null}
              patreonExpiresAt={patreonExpiresAt ?? null}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="dossier-office">
              {primaryOffice ?? t("dossier.noOffice")}
              {otherOffices.length > 0 && (
                <span className="dossier-office-extra"> / {otherOffices.join(" / ")}</span>
              )}
            </p>
            <h1 className="dossier-name">{character.name}</h1>

            <p className="dossier-identity">
              {isIndependent ? (
                <span className="dossier-party">
                  <span className="dossier-party-swatch" aria-hidden />
                  {t("dossier.independent")}
                </span>
              ) : (
                <Link href={partyUrl(countrySlug, party.sequentialId)} className="dossier-party">
                  <span className="dossier-party-swatch" aria-hidden />
                  {party.name}
                </Link>
              )}
              <span className="dossier-sep" aria-hidden>
                /
              </span>
              <Link href={regionUrl(countryId, character.homeState)}>{stateLabel}</Link>
              <span className="dossier-sep" aria-hidden>
                /
              </span>
              <Link href={countryCfg.overviewPath} className="inline-flex items-center gap-1.5">
                <CountryFlag
                  country={countryCfg.code}
                  width={18}
                  height={12}
                  className="h-3 w-auto rounded-[1px] object-cover"
                  title={countryCfg.name}
                />
                {countryCfg.name}
              </Link>
            </p>

            {(patreonTier || user.isAdmin || user.isModerator) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <PatreonBadge
                  tier={patreonTier ?? null}
                  expiresAt={patreonExpiresAt}
                  since={patreonSince}
                  provider={supporterProvider ?? undefined}
                  appearance="tag"
                />
                {user.isAdmin && <span className="dossier-tag">{t("header.admin")}</span>}
                {user.isModerator && !user.isAdmin && (
                  <span className="dossier-tag">{t("header.moderator")}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <figure className="dossier-bio">
          {character.bio ? (
            <blockquote className="line-clamp-4 sm:line-clamp-3">{character.bio}</blockquote>
          ) : (
            <p className="dossier-bio-empty">{t("header.noBio")}</p>
          )}
        </figure>

        {character.campaignSongUrl && (
          <div className="mt-5 border-t border-card-border pt-4">
            <CampaignSongPlayer
              videoId={character.campaignSongUrl}
              characterName={character.name}
            />
          </div>
        )}
      </div>
    </section>
  );
}
