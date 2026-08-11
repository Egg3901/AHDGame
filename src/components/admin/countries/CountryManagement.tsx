"use client";

import { useMemo, useState } from "react";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import {
  CONTINENT_ORDER,
  COUNTRY_CONTINENT,
  type Continent,
} from "@/lib/constants/countryContinents";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { SubTabBar } from "@/components/admin/tabs/SubTabBar";
import CountryOverviewCard from "./CountryOverviewCard";

export default function CountryManagement() {
  const registered = useRegisteredCountries();

  // Registered countries bucketed by continent (preserving registration order).
  const byContinent = useMemo(() => {
    const buckets = Object.fromEntries(
      CONTINENT_ORDER.map((c) => [c, [] as CountryId[]])
    ) as Record<Continent, CountryId[]>;
    for (const id of registered) buckets[COUNTRY_CONTINENT[id]].push(id);
    return buckets;
  }, [registered]);

  const continentTabs = useMemo(() => CONTINENT_ORDER.map((c) => ({ id: c, label: c })), []);

  const initial = registered[0] ?? "US";
  const [selectedContinent, setSelectedContinent] = useState<Continent>(COUNTRY_CONTINENT[initial]);
  const [selectedCountry, setSelectedCountry] = useState<CountryId>(initial);

  const countriesInContinent = byContinent[selectedContinent];
  const countryTabs = countriesInContinent.map((id) => ({ id, label: COUNTRY_CONFIGS[id].name }));

  // Switching continent jumps to its first country so the overview card stays in sync.
  const handleContinentChange = (continent: Continent) => {
    setSelectedContinent(continent);
    const first = byContinent[continent][0];
    if (first) setSelectedCountry(first);
  };

  return (
    <div className="space-y-4">
      <SubTabBar
        options={continentTabs}
        active={selectedContinent}
        onChange={handleContinentChange}
        wrap
      />

      {countriesInContinent.length > 0 ? (
        <div className="space-y-4">
          <SubTabBar
            options={countryTabs}
            active={selectedCountry}
            onChange={setSelectedCountry}
            wrap
          />
          {countriesInContinent.includes(selectedCountry) && (
            <CountryOverviewCard countryId={selectedCountry} />
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted shadow-card">
          No registered countries in {selectedContinent} yet.
        </div>
      )}
    </div>
  );
}
