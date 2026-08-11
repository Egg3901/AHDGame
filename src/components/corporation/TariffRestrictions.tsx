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
    return <div className="h-16 rounded-lg bg-card/60 animate-pulse" />;
  }

  if (countries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        No active trade restrictions affecting this corporation.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {countries.map((country) => (
        <div key={country}>
          <h4 className="mb-2 text-sm font-semibold text-foreground">{country} Tariffs</h4>
          <div className="space-y-1.5">
            {tariffsByCountry[country].map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-md border border-border bg-card/40 px-3 py-2"
              >
                <span className="text-xs text-muted-foreground">
                  {SCOPE_LABELS[t.scopeType] ?? t.scopeType}
                  {t.targetSectorType
                    ? ` — ${CORPORATION_TYPE_LABELS[t.targetSectorType as CorporationType] ?? t.targetSectorType}`
                    : ""}
                </span>
                <span className="text-sm font-semibold text-amber-400">{t.rate}%</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
