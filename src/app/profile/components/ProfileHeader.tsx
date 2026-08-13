import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { PatreonTier, ProfileBorderKey } from "@/lib/db/types";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { ProfilePictureUpload } from "@/components/ProfilePictureUpload";
import { ProfilePictureLightbox } from "./ProfilePictureLightbox";
import { PatreonBadge } from "@/components/patreon/PatreonBadge";
import { CampaignSongPlayer } from "@/components/CampaignSongPlayer";
import { getPartyHex } from "@/lib/utils/politics";
import { regionUrl, partyUrl } from "@/lib/urls";
import { PROFILE_HERO_OVERLAP_CLASSES } from "@/lib/constants/profileHeroLayout";
import { CopyProfileLinkButton } from "./CopyProfileLinkButton";
import { CountryFlag } from "@/components/CountryFlag";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface ProfileHeaderProps {
  character: Character;
  party: PoliticalParty | null;
  user: { username: string; isAdmin: boolean | undefined; isModerator: boolean | undefined };
  memberSince: string;
  officeLabel: string;
  stateLabel: string;
  campaignSongUrl?: string | null;
  campaignSongAutoplay?: boolean;
  viewerDisablesAutoplay?: boolean;
  countrySlug: string;
  patreonHighlightColor?: string | null;
  patreonTier?: PatreonTier;
  patreonExpiresAt?: Date | null;
  patreonSince?: Date | null;
  patreonProfileBorder?: ProfileBorderKey | null;
  /** Own profile href for the copy-link button (omit on other players' profiles) */
  ownProfileHref?: string;
  /** Link shown in the header action area on other players' profiles (e.g. wiki profile) */
  wikiProfileHref?: string;
}

function stateProfileHref(character: Character, countryId: CountryId): string {
  return regionUrl(countryId, character.homeState);
}

export function ProfileHeader({
  character,
  party,
  user,
  memberSince,
  officeLabel,
  stateLabel,
  campaignSongUrl,
  campaignSongAutoplay,
  viewerDisablesAutoplay,
  countrySlug,
  patreonHighlightColor,
  patreonTier,
  patreonExpiresAt,
  patreonSince,
  patreonProfileBorder,
  ownProfileHref,
  wikiProfileHref,
}: ProfileHeaderProps) {
  const t = useTranslations("profile.header");
  const partyHex = getPartyHex(character.party, party?.color ?? undefined);
  const accentHex = patreonHighlightColor ?? partyHex;
  // Prefer persisted countryId; fall back to URL slug from the page (avoids crashes when legacy
  // character docs omit countryId — getCountryConfig(undefined) is undefined).
  const countryId = (character.countryId ?? (countrySlug.toUpperCase() as CountryId)) as CountryId;
  const countryCfg = getCountryConfig(countryId);
  const partyAbbrev =
    character.party === "independent"
      ? t("independent")
      : party?.abbreviation?.trim() || party?.name.slice(0, 3).toUpperCase() || "?";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
      {/* 1) Banner strip only — no avatar inside (avoids “floating centered” absolute bugs) */}
      <div className="relative h-32 sm:h-40 md:h-52">
        {character.profileHeaderImageUrl ? (
          <Image
            src={character.profileHeaderImageUrl}
            alt=""
            fill
            priority
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1280px"
            unoptimized={bypassNextImageOptimization(character.profileHeaderImageUrl)}
          />
        ) : (
          <div
            className="absolute inset-0 bg-gradient-to-br from-card via-card-elevated to-card"
            style={{
              backgroundImage: `linear-gradient(135deg, ${accentHex}33 0%, transparent 45%, ${accentHex}22 100%)`,
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />

        <div
          className="absolute top-0 left-0 right-0 h-1.5"
          style={{ backgroundColor: accentHex }}
        />
      </div>

      {/* 2) Overlap row: pulled up by half avatar height so the fold runs through the avatar center */}
      <div
        className={`relative z-10 px-4 pb-5 pt-0 sm:px-6 lg:px-8 ${PROFILE_HERO_OVERLAP_CLASSES}`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-row items-end gap-3 sm:items-center sm:gap-6">
            <div className="shrink-0">
              {ownProfileHref ? (
                <div
                  className={
                    patreonProfileBorder
                      ? "rounded-2xl bg-transparent p-0 shadow-xl ring-0 sm:p-0"
                      : "rounded-2xl bg-card p-0.5 shadow-xl ring-1 ring-card-border sm:p-1"
                  }
                >
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
              ) : (
                <div
                  className={
                    patreonProfileBorder
                      ? "rounded-2xl bg-transparent p-0 shadow-xl ring-0 sm:p-0"
                      : "rounded-2xl bg-card p-0.5 shadow-xl ring-1 ring-card-border sm:p-1"
                  }
                >
                  <ProfilePictureLightbox
                    avatarUrl={character.avatarUrl}
                    characterName={character.name}
                    borderKey={patreonProfileBorder}
                    tintColor={patreonHighlightColor}
                  />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              {/* Row 1: display name + role/status badges (badges wrap below on tight widths) */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="min-w-0 max-w-full truncate text-lg font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
                  {character.name}
                </h1>
                <PatreonBadge
                  tier={patreonTier ?? null}
                  expiresAt={patreonExpiresAt}
                  since={patreonSince}
                />
                {user.isAdmin && (
                  <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning sm:text-[10px]">
                    {t("admin")}
                  </span>
                )}
                {user.isModerator && !user.isAdmin && (
                  <span className="shrink-0 rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-info sm:text-[10px]">
                    {t("moderator")}
                  </span>
                )}
              </div>

              {/* Row 2: party / location / flag / citizenship as discrete chips */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs">
                {character.party !== "independent" && party ? (
                  <Link
                    href={partyUrl(countrySlug, party.sequentialId)}
                    title={party.name}
                    className="inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-semibold leading-none transition-[filter] hover:brightness-110"
                    style={{
                      borderColor: `${partyHex}59`,
                      backgroundColor: `${partyHex}1f`,
                      color: partyHex,
                    }}
                  >
                    {partyAbbrev}
                  </Link>
                ) : (
                  <span className="inline-flex shrink-0 items-center rounded-md border border-card-border bg-card-elevated/60 px-1.5 py-0.5 font-semibold leading-none text-foreground/80">
                    {t("independent")}
                  </span>
                )}
                <Link
                  href={stateProfileHref(character, countryId)}
                  title={stateLabel}
                  className="inline-flex shrink-0 items-center rounded-md border border-card-border bg-card-elevated/60 px-1.5 py-0.5 font-medium leading-none text-foreground/80 transition-colors hover:text-primary"
                >
                  {stateLabel}
                </Link>
                <Link
                  href={countryCfg.overviewPath}
                  title={countryCfg.name}
                  className="inline-flex shrink-0 items-center rounded-md border border-card-border bg-card-elevated/60 p-1 leading-none opacity-90 transition-opacity hover:opacity-100"
                >
                  <CountryFlag
                    country={countryCfg.code}
                    width={22}
                    height={15}
                    className="h-3.5 w-auto rounded-[2px] object-cover sm:h-4"
                    title={countryCfg.name}
                  />
                </Link>
                <span className="inline-flex min-w-0 items-center rounded-md border border-card-border bg-card-elevated/60 px-1.5 py-0.5 font-medium leading-none text-muted">
                  <span className="truncate">{officeLabel}</span>
                </span>
              </div>

              {/* Row 3: member date */}
              <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted sm:text-xs">
                <svg
                  className="h-3 w-3 shrink-0 opacity-70"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                {t("memberSince", { date: memberSince })}
              </p>

              {ownProfileHref && (
                <div className="mt-3 flex items-center gap-2 sm:hidden">
                  <Link
                    href="/settings"
                    className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-card-border bg-card-elevated px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-card-border/50 hover:text-primary transition-all"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                    {t("editProfile")}
                  </Link>
                  <CopyProfileLinkButton href={ownProfileHref} />
                </div>
              )}
              {!ownProfileHref && wikiProfileHref && (
                <div className="mt-3 sm:hidden">
                  <Link
                    href={wikiProfileHref}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    {t("viewWikiProfile")}
                  </Link>
                </div>
              )}
            </div>
          </div>

          {ownProfileHref && (
            <div className="hidden shrink-0 items-center gap-2 self-end sm:flex">
              <CopyProfileLinkButton href={ownProfileHref} />
              <Link
                href="/settings"
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-card-border bg-card-elevated px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-card-border/50 hover:text-primary transition-all"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
                {t("editProfile")}
              </Link>
            </div>
          )}
          {!ownProfileHref && wikiProfileHref && (
            <div className="hidden shrink-0 self-end sm:flex">
              <Link
                href={wikiProfileHref}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium"
              >
                {t("viewWikiProfile")}
              </Link>
            </div>
          )}
        </div>

        <div className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
            {t("biography")}
          </h2>
          <div className="border-l-2 border-primary/60 bg-primary/5 pl-3 sm:pl-4 py-1.5 rounded-r-md">
            {character.bio ? (
              <p className="text-sm italic leading-relaxed text-muted line-clamp-3 transition-all hover:line-clamp-none sm:line-clamp-2">
                &quot;{character.bio}&quot;
              </p>
            ) : (
              <p className="text-sm italic text-muted/50">{t("noBio")}</p>
            )}
          </div>
          {campaignSongUrl && (
            <div className="mt-4 rounded-lg border border-card-border bg-card-elevated/40 p-3">
              <CampaignSongPlayer
                videoId={campaignSongUrl}
                ownerAutoplay={campaignSongAutoplay ?? false}
                viewerDisablesAutoplay={viewerDisablesAutoplay ?? false}
                characterName={character.name}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
