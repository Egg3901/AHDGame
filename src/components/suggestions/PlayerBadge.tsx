"use client";

import Image from "next/image";
import { getCountryFlagUrlForEra } from "@/lib/constants";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface PlayerBadgeProps {
  partyAbbrev: string | null;
  stateCode: string | null;
  countryId: CountryId | null;
  partySeqId?: number | null;
  characterId?: string | null;
  size?: "sm" | "md";
}

export function PlayerBadge({ partyAbbrev, stateCode, countryId, size = "sm" }: PlayerBadgeProps) {
  const preset = useActivePreset();
  if (!partyAbbrev && !stateCode) return null;

  const textSize = size === "sm" ? "text-[10px]" : "text-xs";
  const flagH = size === "sm" ? "h-3 max-h-3" : "h-3.5 max-h-3.5";

  const cfg = countryId ? getCountryConfig(countryId) : null;

  return (
    <span className={`inline-flex items-center gap-0.5 ${textSize}`}>
      <span className="text-muted">(</span>
      {partyAbbrev && <span className="text-foreground/80 font-medium">{partyAbbrev}</span>}
      {partyAbbrev && stateCode && <span className="text-muted">-</span>}
      {stateCode && <span className="text-foreground/70">{stateCode}</span>}
      <span className="text-muted">)</span>
      {cfg && (
        <Image
          src={getCountryFlagUrlForEra(cfg.code, preset)}
          alt={cfg.name}
          width={16}
          height={11}
          className={`${flagH} w-auto rounded-sm object-cover ring-1 ring-card-border/50 ml-0.5`}
          unoptimized={bypassNextImageOptimization(getCountryFlagUrlForEra(cfg.code, preset))}
        />
      )}
    </span>
  );
}
