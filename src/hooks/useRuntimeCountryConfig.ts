"use client";

import { useEffect, useMemo, useState } from "react";
import type { CountryId, GovernmentType, OpsVoteMultipliers } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

export interface RuntimeCountryConfig {
  countryId: CountryId;
  governmentType: GovernmentType;
  rulingPartyId: number | null;
  opsVoteMultipliers: OpsVoteMultipliers | null;
  hasLeaderConfidenceModel: boolean;
}

export interface UseRuntimeCountryConfigResult {
  /** Runtime-fetched config, or a seed-derived fallback while loading. */
  config: RuntimeCountryConfig | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the runtime-mutable country config (governmentType + ruling-party
 * + vote-multipliers + leader-confidence-model flag) for the given country.
 *
 * Returns a seed-derived fallback (via useMemo, no extra render) while
 * loading so the UI doesn't flash empty. A post-Stage-4 converted country
 * shows the seed value briefly before the real fetch resolves to the
 * runtime value.
 */
export function useRuntimeCountryConfig(
  countryId: CountryId | string | undefined
): UseRuntimeCountryConfigResult {
  const seed = useMemo(() => seedFallback(countryId), [countryId]);
  const [fetched, setFetched] = useState<RuntimeCountryConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!countryId) {
      return;
    }
    let cancelled = false;
    fetch(`/api/country/${countryId.toLowerCase()}/runtime-config`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as RuntimeCountryConfig;
      })
      .then((data) => {
        if (cancelled) return;
        setFetched(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  // Prefer fetched runtime value; fall back to seed while loading or on error.
  const config = fetched ?? seed;
  return { config, loading: countryId ? loading : false, error };
}

function seedFallback(countryId: CountryId | string | undefined): RuntimeCountryConfig | null {
  if (!countryId) return null;
  const upper = countryId.toUpperCase() as CountryId;
  const cfg = COUNTRY_CONFIGS[upper];
  if (!cfg) return null;
  return {
    countryId: upper,
    governmentType: cfg.governmentType,
    rulingPartyId: cfg.rulingPartyId ?? null,
    opsVoteMultipliers: cfg.opsVoteMultipliers ?? null,
    hasLeaderConfidenceModel: cfg.hasLeaderConfidenceModel ?? false,
  };
}
