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
 * of text. The party colour appears once, as the swatch beside the party.
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
    <section
      className="dossier-record overflow-hidden rounded-lg border border-card-border bg-card"
      style={{ "--dossier-party": partyHex } as CSSProperties}
    >
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

      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:gap-5 sm:p-6">
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
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <h1 className="dossier-name">{character.name}</h1>
              <p className="dossier-office">
                {officeLabels.length > 0 ? officeLabels.join(", ") : t("dossier.noOffice")}
              </p>
            </div>
            <div className="dossier-actions flex shrink-0 items-center gap-2">
              <CopyProfileLinkButton href={ownProfileHref} />
              <Link href="/settings" className="dossier-button">
                {t("header.editProfile")}
              </Link>
            </div>
          </div>

          <p className="dossier-facts">
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
            <span>
              <Link href={regionUrl(countryId, character.homeState)}>{stateLabel}</Link>,{" "}
              <Link href={countryCfg.overviewPath}>{countryCfg.name}</Link>
            </span>
            <span>{t("header.memberSince", { date: memberSince })}</span>
            {patreonTier && (
              <PatreonBadge
                tier={patreonTier}
                expiresAt={patreonExpiresAt}
                since={patreonSince}
                provider={supporterProvider ?? undefined}
                appearance="tag"
              />
            )}
            {user.isAdmin && <span>{t("header.admin")}</span>}
            {user.isModerator && !user.isAdmin && <span>{t("header.moderator")}</span>}
          </p>

          {character.bio ? (
            <p className="dossier-bio">{character.bio}</p>
          ) : (
            <p className="dossier-bio dossier-bio-empty">{t("header.noBio")}</p>
          )}

          {character.campaignSongUrl && (
            <div className="mt-4">
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
