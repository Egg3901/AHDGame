"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import type { SerializedOfficial } from "../StatePageTabsTypes";
import type { CountryId } from "@/lib/constants/countries";
import { NppAbbr } from "@/components/elections/NppAbbr";

function deriveAbbreviation(name?: string | null): string | undefined {
  if (!name) return undefined;
  const abbr = name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4);
  return abbr || undefined;
}

/**
 * One officeholder as a list row: avatar, name (linked to the profile), the
 * office and seat line, and the party as a swatch and abbreviation. Vacant
 * seats keep the row so the chamber's size stays legible.
 */
export function OfficialRow({
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
    null;
  const partyColor = official?.partyColor ?? "#888888";
  const detail = [title, subtitle].filter(Boolean).join(", ");

  return (
    <li className="flex items-center gap-3 py-3">
      <Avatar
        url={official?.avatarUrl}
        name={displayName}
        size="h-10 w-10"
        className={isVacant ? "opacity-50 grayscale" : ""}
        borderKey={official?.borderKey}
        tintColor={official?.tintColor}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          {profileLink ? (
            <Link
              href={profileLink}
              className="truncate text-body font-medium text-foreground underline-offset-4 hover:underline"
            >
              {displayName}
            </Link>
          ) : (
            <span className="truncate text-body text-muted">{displayName}</span>
          )}
          {official?.isNPP && !isVacant && (
            <span className="shrink-0 text-body-sm text-muted">
              <NppAbbr />
            </span>
          )}
        </div>
        <p className="truncate text-body-sm text-muted">{detail}</p>
      </div>
      {!isVacant && partyLabel && (
        <span
          className="flex shrink-0 items-center gap-1.5 text-body-sm font-semibold"
          style={{ color: partyColor }}
        >
          <PartyLogo
            partyId={official?.party ?? "independent"}
            partyColor={partyColor}
            size="h-4 w-4"
            countryId={countryId}
          />
          {partyLabel}
        </span>
      )}
    </li>
  );
}
