"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import type { SerializedOfficial } from "../StatePageTabsTypes";
import type { CountryId } from "@/lib/constants/countries";

function deriveAbbreviation(name?: string | null): string | undefined {
  if (!name) return undefined;
  const abbr = name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4);
  return abbr || undefined;
}

export function OfficialCard({
  official,
  title,
  subtitle,
  isVacant,
  countryId,
}: {
  official: SerializedOfficial | null;
  title: string;
  subtitle?: string;
  isVacant: boolean;
  countryId?: CountryId;
}) {
  const profileLink =
    official && !isVacant && (official.characterId || official.nppId)
      ? official.isNPP && official.nppId
        ? official.nppSequentialId
          ? `/politicians/npp/${official.nppSequentialId}`
          : `/politicians/npp/${official.nppId}`
        : official.characterSequentialId
          ? `/character/${official.characterSequentialId}`
          : `/character/${official.characterId}`
      : null;

  const displayName = official?.characterName ?? "Vacant";
  const partyLabel =
    official?.partyAbbreviation ??
    deriveAbbreviation(official?.partyName) ??
    official?.party ??
    "—";
  const partyColor = official?.partyColor ?? "#888888";

  return (
    <div className="relative flex flex-col items-center overflow-hidden rounded-xl border border-card-border bg-card px-3 pb-4 pt-1 transition-colors card-hover hover:border-primary/30 hover:bg-card-elevated">
      {/* Party-color top accent */}
      {!isVacant && official?.partyColor && (
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ backgroundColor: official.partyColor }}
        />
      )}

      {/* Avatar with NPP overlay */}
      <div className="relative mt-4">
        <Avatar
          url={official?.avatarUrl}
          name={displayName}
          size="h-16 w-16"
          className={isVacant ? "opacity-50 grayscale" : ""}
          borderKey={official?.borderKey}
          tintColor={official?.tintColor}
        />
        {official?.isNPP && !isVacant && (
          <span className="absolute -bottom-1 -right-1 rounded-full border border-purple-500/60 bg-card px-1 py-px text-[8px] font-bold leading-none text-purple-400">
            NPP
          </span>
        )}
      </div>

      {/* Text */}
      <div className="mt-3 w-full min-w-0 text-center">
        {profileLink ? (
          <Link
            href={profileLink}
            className="line-clamp-2 block text-sm font-semibold leading-tight text-foreground hover:text-primary"
          >
            {displayName}
          </Link>
        ) : (
          <span className="line-clamp-2 block text-sm font-semibold leading-tight text-muted">
            {displayName}
          </span>
        )}
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
          {title}
        </p>
        {subtitle && <p className="text-[10px] text-muted/60">{subtitle}</p>}

        {/* Party badge */}
        <div className="mt-2.5 flex justify-center">
          {isVacant ? (
            <span className="rounded-full border border-card-border bg-card-elevated px-2.5 py-0.5 text-[10px] text-muted">
              —
            </span>
          ) : (
            <span
              className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              style={{
                borderColor: partyColor + "60",
                backgroundColor: partyColor + "18",
                color: partyColor,
              }}
            >
              <PartyLogo
                partyId={official?.party ?? "independent"}
                partyColor={partyColor}
                size="h-3 w-3"
                countryId={countryId}
              />
              <span className="truncate">{partyLabel}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
