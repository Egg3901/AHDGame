"use client";

import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { BondMarketDemandWidget } from "@/components/country/BondMarketDemandWidget";

/**
 * Renders the Bond Market Demand widget for every configured country in a
 * 2-column grid. Each widget self-fetches its country's sovereign-status
 * snapshot in parallel — small N (~8 countries) keeps fan-out manageable.
 */
export function GlobalBondMarketDemandPanel() {
  const registered = useRegisteredCountries();
  const entries = registered
    .map((id) => [id, COUNTRY_CONFIGS[id]] as [CountryId, { name: string }])
    .sort(([a], [b]) => a.localeCompare(b));
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
        <span className="mr-2 inline-block h-3 w-0.5 bg-rose-600 align-middle" />
        Sovereign Debt
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {entries.map(([code, cfg]) => (
          <BondMarketDemandWidget key={code} countryCode={code} countryLabel={cfg.name} />
        ))}
      </div>
    </section>
  );
}
