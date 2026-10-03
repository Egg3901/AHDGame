import { Fragment } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { PatreonTier, ProfileBorderKey, SupporterProvider } from "@/lib/db/types";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { ProfilePictureUpload } from "@/components/ProfilePictureUpload";
import { ProfilePictureLightbox } from "./ProfilePictureLightbox";
import { PatreonBadge } from "@/components/patreon/PatreonBadge";
import { CampaignSongPlayer } from "@/components/CampaignSongPlayer";
import { getPartyHex } from "@/lib/utils/politics";
import { regionUrl, partyUrl } from "@/lib/urls";
import { CopyProfileLinkButton } from "./CopyProfileLinkButton";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { Tooltip } from "@/components/ui/Tooltip";
import { PROFILE_BUTTON_CLASS, PROFILE_LINK_CLASS } from "./profileStyles";

interface ProfileHeaderProps {
  character: Character;
  party: PoliticalParty | null;
  user: { username: string; isAdmin: boolean | undefined; isModerator: boolean | undefined };
  memberSince: string;
  memberSinceIsApproximate?: boolean;
  officeLabels: readonly string[];
  stateLabel: string;
  campaignSongUrl?: string | null;
  countrySlug: string;
  patreonHighlightColor?: string | null;
  patreonTier?: PatreonTier;
  patreonExpiresAt?: Date | null;
  patreonSince?: Date | null;
  patreonProfileBorder?: ProfileBorderKey | null;
  /** Which system granted the benefits. Drives provider-neutral badge copy so a
   *  Lakeside subscriber is not described as a Patreon patron. */
  supporterProvider?: SupporterProvider | null;
  /** Own profile href for the copy-link button (omit on other players' profiles) */
  ownProfileHref?: string;
  /** Link shown in the header action area on other players' profiles (e.g. wiki profile) */
  wikiProfileHref?: string;
  /** The viewer blocked this player, so their biography stays hidden. */
  bioHidden?: boolean;
}

/**
 * Identity block at the top of the own and public profile. No frame: the
 * player's uploaded banner (when there is one), then the portrait, name and
 * office, with party, place, join date and roles set as one line of text.
 * The party colour appears once, as the swatch beside the party name.
 */
export function ProfileHeader({
  character,
  party,
  user,
  memberSince,
  memberSinceIsApproximate = false,
  officeLabels,
  stateLabel,
  campaignSongUrl,
  countrySlug,
  patreonHighlightColor,
  patreonTier,
  patreonExpiresAt,
  patreonSince,
  patreonProfileBorder,
  supporterProvider,
  ownProfileHref,
  wikiProfileHref,
  bioHidden = false,
}: ProfileHeaderProps) {
  const t = useTranslations("profile.header");
  const partyHex = getPartyHex(character.party, party?.color ?? undefined);
  // Prefer persisted countryId; fall back to URL slug from the page (avoids crashes when legacy
  // character docs omit countryId; getCountryConfig(undefined) is undefined).
  const countryId = (character.countryId ?? (countrySlug.toUpperCase() as CountryId)) as CountryId;
  const countryCfg = getCountryConfig(countryId);
  const inParty = character.party !== "independent" && party != null;

  const actions = ownProfileHref ? (
    <div className="flex shrink-0 items-center gap-2">
      <CopyProfileLinkButton href={ownProfileHref} />
      <Link href="/settings" className={PROFILE_BUTTON_CLASS}>
        {t("editProfile")}
      </Link>
    </div>
  ) : wikiProfileHref ? (
    <Link href={wikiProfileHref} className={`shrink-0 text-body ${PROFILE_LINK_CLASS}`}>
      {t("viewWikiProfile")}
    </Link>
  ) : null;

  return (
    <header className="space-y-5">
      {character.profileHeaderImageUrl && (
        <div className="relative h-28 overflow-hidden rounded-lg bg-card-elevated sm:h-40 md:h-48">
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

      {/* Portrait beside the name at every width; the facts sit under the name
          on wider screens and run full width on phones. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-4 sm:gap-x-6 sm:gap-y-3">
        <div className="sm:row-span-2">
          {ownProfileHref ? (
            <ProfilePictureUpload
              currentUrl={character.avatarUrl}
              characterName={character.name}
              size="header"
              borderKey={patreonProfileBorder}
              tintColor={patreonHighlightColor}
              patreonTier={patreonTier ?? null}
              patreonExpiresAt={patreonExpiresAt ?? null}
            />
          ) : (
            <ProfilePictureLightbox
              avatarUrl={character.avatarUrl}
              characterName={character.name}
              size="header"
              borderKey={patreonProfileBorder}
              tintColor={patreonHighlightColor}
            />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h1 className="break-words font-sans text-heading-lg font-semibold tracking-tight text-foreground sm:text-display">
              {character.name}
            </h1>
            <p className="mt-1 text-body-lg text-foreground/80">
              {officeLabels.map((officeLabel, index) => (
                <Fragment key={officeLabel}>
                  {index > 0 && ", "}
                  <span>{officeLabel}</span>
                </Fragment>
              ))}
            </p>
          </div>
          {actions}
        </div>

        <div className="col-span-2 space-y-4 sm:col-span-1 sm:col-start-2">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-muted">
            {inParty ? (
              <Link
                href={partyUrl(countrySlug, party.sequentialId)}
                title={party.name}
                className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: partyHex }}
                />
                {party.name}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{t("independent")}</span>
            )}
            <span>
              <Link
                href={regionUrl(countryId, character.homeState)}
                title={stateLabel}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {stateLabel}
              </Link>
              {", "}
              <Link
                href={countryCfg.overviewPath}
                title={countryCfg.name}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {countryCfg.name}
              </Link>
            </span>
            <span>
              {t(memberSinceIsApproximate ? "memberSinceEarlier" : "memberSince", {
                date: memberSince,
              })}
              {memberSinceIsApproximate && (
                <Tooltip
                  variant="footnote"
                  label={t("memberSinceExplanation")}
                  content={t("memberSinceHistoryLost")}
                />
              )}
            </span>
            <PatreonBadge
              tier={patreonTier ?? null}
              expiresAt={patreonExpiresAt}
              since={patreonSince}
              provider={supporterProvider ?? undefined}
              appearance="tag"
            />
            {user.isAdmin && <span className="font-medium text-foreground">{t("admin")}</span>}
            {user.isModerator && !user.isAdmin && (
              <span className="font-medium text-foreground">{t("moderator")}</span>
            )}
          </p>

          {!bioHidden &&
            (character.bio ? (
              <p className="max-w-prose text-body leading-relaxed text-foreground/85">
                {character.bio}
              </p>
            ) : (
              <p className="text-body text-muted">{t("noBio")}</p>
            ))}

          {campaignSongUrl && (
            <div className="store-app-hidden max-w-md">
              <CampaignSongPlayer videoId={campaignSongUrl} characterName={character.name} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
