"use client";

import { useState, useEffect } from "react";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";

interface TariffEntry {
  id: string;
  scopeType: string;
  targetSectorType: string | null;
  targetOriginCountryId: string | null;
  targetCorporationId: string | null;
  rate: number;
}

interface TariffRestrictionsProps {
  /** The corporation's HQ country (e.g., "US") */
  corpHqCountryId: string;
  /** ID of the corporation (ObjectId string) */
  corporationId: string;
  /** Countries where this corp has sectors */
  operatingCountries: string[];
}

const SCOPE_LABELS: Record<string, string> = {
  economy_wide: "Economy-wide",
  sector: "Sector",
  origin_country: "Origin Country",
  corporation: "Corporation",
};

export function TariffRestrictions({
  corpHqCountryId,
  corporationId,
  operatingCountries,
}: TariffRestrictionsProps) {
  const [tariffsByCountry, setTariffsByCountry] = useState<Record<string, TariffEntry[]>>({});
  const [loading, setLoading] = useState(true);

  const operatingCountriesKey = operatingCountries.join(",");

  useEffect(() => {
    // Only show tariffs from countries where this corp is FOREIGN
    const foreignCountries = operatingCountries.filter((c) => c !== corpHqCountryId);
    if (foreignCountries.length === 0) {
      setLoading(false);
      return;
    }

    Promise.all(
      foreignCountries.map((c) =>
        fetch(`/api/tariffs?countryId=${c}`)
          .then((r) => r.json())
          .then((d) => ({ country: c, tariffs: (d.tariffs ?? []) as TariffEntry[] }))
      )
    )
      .then((results) => {
        const map: Record<string, TariffEntry[]> = {};
        for (const r of results) {
          // Filter to tariffs that affect THIS corp: economy_wide, sector, origin_country matching HQ, or corp-specific
          const relevant = r.tariffs.filter(
            (t) =>
              t.rate > 0 &&
              (t.scopeType === "economy_wide" ||
                t.scopeType === "sector" ||
                (t.scopeType === "origin_country" && t.targetOriginCountryId === corpHqCountryId) ||
                (t.scopeType === "corporation" && t.targetCorporationId === corporationId))
          );
          if (relevant.length) map[r.country] = relevant;
        }
        setTariffsByCountry(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // operatingCountriesKey is a stable derived string from operatingCountries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpHqCountryId, corporationId, operatingCountriesKey]);

  const countries = Object.keys(tariffsByCountry);

  if (loading) {
    return <div className="h-8 animate-pulse border-b border-card-border/60" />;
  }

  if (countries.length === 0) {
    return (
      <p className="py-1 text-xs text-muted">
        No active trade restrictions affect this corporation.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse">
      <tbody>
        {countries.flatMap((country) =>
          tariffsByCountry[country].map((t) => (
            <tr key={t.id}>
              <td className="border-b border-card-border/60 py-1.5 pr-2 text-xs text-muted">
                {country}, {SCOPE_LABELS[t.scopeType] ?? t.scopeType}
                {t.targetSectorType
                  ? `, ${CORPORATION_TYPE_LABELS[t.targetSectorType as CorporationType] ?? t.targetSectorType}`
                  : ""}
              </td>
              <td className="whitespace-nowrap border-b border-card-border/60 py-1.5 text-right font-mono text-[13px] text-warning">
                {t.rate}% tariff
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
