"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import type { CountryAvailability } from "@/lib/countryAvailability";
import type { NationWorldSnapshot } from "@/lib/world/nationWorldSnapshots";
import StatusBadge from "./StatusBadge";
import { CountryFlag } from "@/components/CountryFlag";
import { useWorldMetricFilterOptional } from "../WorldMetricFilterContext";
import { getMetricFilterHighlight } from "../worldMetricHighlight";

interface CountryCardProps {
  id: CountryId;
  availability: CountryAvailability;
  nationSnapshot?: NationWorldSnapshot;
}

/** Shown when a country has no snapshot yet (e.g. a just-activated nation) — a
 *  missing snapshot must degrade to "Vacant", never crash the whole /world page. */
const VACANT_SNAPSHOT: NationWorldSnapshot = {
  executive: {
    name: "—",
    avatarUrl: null,
    borderKey: null,
    tintColor: null,
    isNpp: false,
    sequentialId: null,
    nppSequentialId: null,
    isVacant: true,
  },
  legislatureParty: null,
};

export default function CountryCard({
  id,
  availability,
  nationSnapshot: rawSnapshot,
}: CountryCardProps) {
  const nationSnapshot = rawSnapshot ?? VACANT_SNAPSHOT;
  const country = COUNTRY_CONFIGS[id];
  const name = useCountryDisplayName()(id);
  const flagUrl = country.heroImage;
  const isPlayable = availability.accessMode === "full";
  const isEconOnly = availability.accessMode === "econ-only";
  const worldMetricCtx = useWorldMetricFilterOptional();
  const filterHighlight =
    worldMetricCtx && worldMetricCtx.metricFilter.type !== "none"
      ? getMetricFilterHighlight(
          worldMetricCtx.metricFilter,
          id,
          worldMetricCtx.countryIdToIso(id),
          worldMetricCtx.worldMetrics,
          worldMetricCtx.partyData,
          worldMetricCtx.corpsData
        )
      : null;

  const linkHref = availability.preferredPath ?? "#";
  const isClickable = availability.isClickable;

  return (
    <Link
      href={linkHref}
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all duration-300 ${
        isClickable
          ? isPlayable
            ? "border-card-border hover:border-primary/50 hover:shadow-lg hover:-translate-y-1 cursor-pointer"
            : "border-secondary/30 hover:border-secondary/60 hover:shadow-lg hover:-translate-y-1 cursor-pointer"
          : "border-card-border/50 opacity-75 cursor-default grayscale-[0.3]"
      }`}
      aria-disabled={!isClickable}
    >
      <div className="relative h-32 w-full overflow-hidden bg-card-muted">
        {flagUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
            style={{ backgroundImage: `url(${flagUrl})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
          <div className="flex items-center gap-2">
            <CountryFlag country={id} size="lg" className="drop-shadow-md" />
            <h3 className="text-xl font-bold text-white drop-shadow-md">{name}</h3>
          </div>
          <StatusBadge availability={availability} />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4 gap-3">
        <p className="text-xs font-medium text-primary uppercase tracking-wider">
          {country.governmentTypeLabel}
        </p>

        {isEconOnly && (
          <div className="rounded-lg border border-secondary/30 bg-secondary/10 px-3 py-2 space-y-1.5">
            <p className="text-[10px] font-semibold text-secondary uppercase tracking-wide">
              Econ-Only Nation
            </p>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-emerald-400 font-medium">Every page viewable</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted">No actions</span>
            </div>
          </div>
        )}

        <p className="text-sm text-muted line-clamp-2 min-h-[2.5em]">{country.descriptor}</p>

        {filterHighlight && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
            <p className="text-[10px] text-muted tracking-wide">{filterHighlight.label}</p>
            <p className="text-sm font-semibold text-foreground tabular-nums">
              {filterHighlight.value}
            </p>
          </div>
        )}

        <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
          <div className="rounded-lg bg-card-elevated p-2 border border-card-border/50 flex flex-col gap-1.5 min-h-[4.25rem]">
            <p className="text-[10px] text-muted uppercase tracking-wide">
              {country.executiveTitle}
            </p>
            <div className="flex items-center gap-2 min-w-0">
              <Avatar
                url={
                  nationSnapshot.executive.isVacant ? undefined : nationSnapshot.executive.avatarUrl
                }
                name={nationSnapshot.executive.isVacant ? "Vacant" : nationSnapshot.executive.name}
                size="h-9 w-9"
                borderKey={nationSnapshot.executive.borderKey}
                tintColor={nationSnapshot.executive.tintColor}
                className={
                  nationSnapshot.executive.isVacant
                    ? "opacity-60 ring-1 ring-dashed ring-card-border"
                    : ""
                }
              />
              <span
                className={`text-xs font-semibold truncate ${
                  nationSnapshot.executive.isVacant ? "text-muted" : "text-foreground"
                }`}
              >
                {nationSnapshot.executive.isVacant ? "Vacant" : nationSnapshot.executive.name}
              </span>
            </div>
          </div>
          <div className="rounded-lg bg-card-elevated p-2 border border-card-border/50 flex flex-col gap-1.5 min-h-[4.25rem]">
            <p className="text-[10px] text-muted uppercase tracking-wide">Leading party</p>
            <div className="flex items-center gap-2 min-w-0">
              {nationSnapshot.legislatureParty ? (
                <>
                  <PartyLogo
                    partyId={nationSnapshot.legislatureParty.partySequentialId}
                    partyColor={nationSnapshot.legislatureParty.partyColor}
                    countryId={id}
                    size="h-8 w-8"
                    logoAlt=""
                  />
                  <span className="text-xs font-semibold text-foreground truncate">
                    {nationSnapshot.legislatureParty.partyName}
                  </span>
                </>
              ) : (
                <span className="text-xs font-semibold text-muted">Vacant</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
