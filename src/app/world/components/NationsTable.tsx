"use client";

import Image from "next/image";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import { CountryFlag } from "@/components/CountryFlag";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCountryFlagUrlForEra } from "@/lib/constants";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { useActivePreset, useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import type { CountryAvailability, CountryAvailabilityState } from "@/lib/countryAvailability";
import type { NationWorldSnapshot } from "@/lib/world/nationWorldSnapshots";
import type { WorldRoadmapCountry } from "@/lib/worldCountryRegistry";
import { useWorldMetricFilterOptional } from "../WorldMetricFilterContext";
import { getMetricFilterHighlight } from "../worldMetricHighlight";

/** A nation's status as one plain word, the same vocabulary the map tooltip uses. */
const STATUS_WORD: Record<CountryAvailabilityState, string> = {
  playable: "Active",
  "beta-access": "Beta access",
  "econ-only": "Econ-only",
  hidden: "Under development",
};

/** Shown when a country has no snapshot yet (a just-activated nation): the row
 *  degrades to "Vacant" rather than crashing the whole /world page. */
const VACANT_SNAPSHOT: NationWorldSnapshot = {
  executive: {
    name: "Vacant",
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

const TH = "border-b border-card-border pb-2 pr-4 text-left text-body-sm font-medium text-muted";
const TD = "border-b border-card-border/60 py-3 pr-4 align-top";

export interface NationRow {
  id: CountryId;
  availability: CountryAvailability;
  snapshot?: NationWorldSnapshot;
}

/**
 * Every registered nation a player can open, one row each: playable nations
 * first, then the econ-only ones. Status is a word, not a coloured pill. On a
 * phone the government, leader and party fold under the nation's name so the
 * table keeps two columns and every figure stays visible.
 */
export function NationsTable({ rows }: { rows: NationRow[] }) {
  const countryName = useCountryDisplayName();
  const worldMetricCtx = useWorldMetricFilterOptional();
  const highlights = new Map(
    rows.map((row) => [
      row.id,
      worldMetricCtx && worldMetricCtx.metricFilter.type !== "none"
        ? getMetricFilterHighlight(
            worldMetricCtx.metricFilter,
            row.id,
            worldMetricCtx.countryIdToIso(row.id),
            worldMetricCtx.worldMetrics,
            worldMetricCtx.partyData,
            worldMetricCtx.corpsData
          )
        : null,
    ])
  );
  const highlightLabel = [...highlights.values()].find((h) => h !== null)?.label ?? null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Nation
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={`${TH} hidden md:table-cell`}>
              Government
            </th>
            <th scope="col" className={`${TH} hidden md:table-cell`}>
              Leader
            </th>
            <th scope="col" className={`${TH} hidden md:table-cell`}>
              Leading party
            </th>
            {highlightLabel && (
              <th scope="col" className={`${TH} hidden text-right md:table-cell`}>
                {highlightLabel}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const config = COUNTRY_CONFIGS[row.id];
            const snapshot = row.snapshot ?? VACANT_SNAPSHOT;
            const executive = snapshot.executive;
            const party = snapshot.legislatureParty;
            const name = countryName(row.id);
            const highlight = highlights.get(row.id) ?? null;
            const href = row.availability.isClickable ? row.availability.preferredPath : null;
            const isPlayable = row.availability.accessMode === "full";
            const executiveName = executive.isVacant ? "Vacant" : executive.name;
            return (
              <tr
                key={row.id}
                className={href ? "transition-colors hover:bg-card-elevated/40" : ""}
              >
                <td className={TD}>
                  <div className="flex items-center gap-2.5">
                    <CountryFlag country={row.id} size="lg" />
                    {href ? (
                      <Link
                        href={href}
                        className="text-body-lg font-semibold text-foreground underline-offset-4 hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="text-body-lg font-semibold text-muted">{name}</span>
                    )}
                  </div>
                  <div className="mt-1 space-y-0.5 text-body-sm text-muted md:hidden">
                    <p>{config.governmentTypeLabel}</p>
                    <p>
                      {config.executiveTitle}:{" "}
                      <span className={executive.isVacant ? "" : "text-foreground"}>
                        {executiveName}
                      </span>
                    </p>
                    <p>
                      Leading party:{" "}
                      <span className={party ? "text-foreground" : ""}>
                        {party ? party.partyName : "Vacant"}
                      </span>
                    </p>
                    {highlight && (
                      <p>
                        {highlight.label}:{" "}
                        <span className="tabular-nums text-foreground">{highlight.value}</span>
                      </p>
                    )}
                  </div>
                </td>
                <td
                  className={`${TD} whitespace-nowrap ${isPlayable ? "text-foreground" : "text-muted"}`}
                >
                  {STATUS_WORD[row.availability.displayState]}
                </td>
                <td className={`${TD} hidden text-muted md:table-cell`}>
                  {config.governmentTypeLabel}
                </td>
                <td className={`${TD} hidden md:table-cell`}>
                  <div className="flex items-center gap-2">
                    <Avatar
                      url={executive.isVacant ? undefined : executive.avatarUrl}
                      name={executiveName}
                      size="h-7 w-7"
                      borderKey={executive.borderKey}
                      tintColor={executive.tintColor}
                      className={executive.isVacant ? "opacity-60" : ""}
                    />
                    <div className="min-w-0">
                      <p
                        className={`truncate font-medium ${
                          executive.isVacant ? "text-muted" : "text-foreground"
                        }`}
                      >
                        {executiveName}
                      </p>
                      <p className="text-body-sm text-muted">{config.executiveTitle}</p>
                    </div>
                  </div>
                </td>
                <td className={`${TD} hidden md:table-cell`}>
                  {party ? (
                    <div className="flex items-center gap-2">
                      <PartyLogo
                        partyId={party.partySequentialId}
                        partyColor={party.partyColor}
                        countryId={row.id}
                        size="h-6 w-6"
                        logoAlt=""
                      />
                      <span className="min-w-0 font-medium text-foreground">{party.partyName}</span>
                    </div>
                  ) : (
                    <span className="text-muted">Vacant</span>
                  )}
                </td>
                {highlightLabel && (
                  <td className={`${TD} hidden text-right tabular-nums md:table-cell`}>
                    {highlight ? (
                      <span className="font-semibold text-foreground">{highlight.value}</span>
                    ) : (
                      <span className="text-muted">No data</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Nations that are not open yet: registered countries still under development,
 * and roadmap countries that have no world behind them. Neither links anywhere.
 */
export function PlannedNationsTable({
  hidden,
  roadmap,
}: {
  hidden: NationRow[];
  roadmap: WorldRoadmapCountry[];
}) {
  const countryName = useCountryDisplayName();
  const preset = useActivePreset();
  return (
    <table className="w-full border-collapse text-body">
      <thead>
        <tr>
          <th scope="col" className={TH}>
            Nation
          </th>
          <th scope="col" className={TH}>
            Status
          </th>
          <th scope="col" className={`${TH} hidden sm:table-cell`}>
            Government or region
          </th>
        </tr>
      </thead>
      <tbody>
        {hidden.map((row) => {
          const config = COUNTRY_CONFIGS[row.id];
          return (
            <tr key={row.id}>
              <td className={TD}>
                <div className="flex items-center gap-2.5">
                  <CountryFlag country={row.id} size="lg" />
                  <span className="text-body-lg font-semibold text-muted">
                    {countryName(row.id)}
                  </span>
                </div>
                <p className="mt-1 text-body-sm text-muted sm:hidden">
                  {config.governmentTypeLabel}
                </p>
              </td>
              <td className={`${TD} whitespace-nowrap text-muted`}>
                {STATUS_WORD[row.availability.displayState]}
              </td>
              <td className={`${TD} hidden text-muted sm:table-cell`}>
                {config.governmentTypeLabel}
              </td>
            </tr>
          );
        })}
        {roadmap.map((country) => {
          const flagUrl = getCountryFlagUrlForEra(country.id, preset);
          return (
            <tr key={country.id}>
              <td className={TD}>
                <div className="flex items-center gap-2.5">
                  <Image
                    src={flagUrl}
                    alt={`${country.name} flag`}
                    width={24}
                    height={16}
                    className="inline-block shrink-0 rounded-sm object-cover"
                    unoptimized={bypassNextImageOptimization(flagUrl)}
                  />
                  <span className="text-body-lg font-semibold text-muted">{country.name}</span>
                </div>
                <p className="mt-1 text-body-sm text-muted sm:hidden">{country.region}</p>
              </td>
              <td className={`${TD} whitespace-nowrap text-muted`}>
                {country.featured ? "Beta access" : "Planned"}
              </td>
              <td className={`${TD} hidden text-muted sm:table-cell`}>{country.region}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
