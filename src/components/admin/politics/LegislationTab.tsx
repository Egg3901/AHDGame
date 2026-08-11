"use client";

import { useMemo, useState } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  CONTINENT_ORDER,
  COUNTRY_CONTINENT,
  type Continent,
} from "@/lib/constants/countryContinents";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { SubTabBar } from "@/components/admin/tabs/SubTabBar";
import { AdminBillsSection } from "./AdminBillsSection";
import { AdminCabinetSection } from "./AdminCabinetSection";
import { AdminLeadershipSection } from "./AdminLeadershipSection";

type SubTab = "legislation" | "cabinet" | "leadership";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "legislation", label: "Legislation" },
  { id: "cabinet", label: "Cabinet Nominations" },
  { id: "leadership", label: "Leadership" },
];

// Cabinet confirmation votes and Speaker/Majority-Leader elections are only
// modeled in the admin backends for the US and UK; every other country gets
// the legislation queue alone.
const FULL_SUB_TAB_COUNTRIES: ReadonlySet<CountryId> = new Set(["US", "UK"]);

export function LegislationTab() {
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
  const [activeContinent, setActiveContinent] = useState<Continent>(COUNTRY_CONTINENT[initial]);
  const [activeCountry, setActiveCountry] = useState<CountryId>(initial);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("legislation");

  const countriesInContinent = byContinent[activeContinent];
  const countryTabs = countriesInContinent.map((id) => ({ id, label: COUNTRY_CONFIGS[id].name }));

  const handleCountryChange = (country: CountryId) => {
    setActiveCountry(country);
    setActiveSubTab("legislation");
  };

  // Switching continent jumps to its first country so the sections stay in sync.
  const handleContinentChange = (continent: Continent) => {
    setActiveContinent(continent);
    const first = byContinent[continent][0];
    if (first) handleCountryChange(first);
  };

  const visibleSubTabs = FULL_SUB_TAB_COUNTRIES.has(activeCountry)
    ? SUB_TABS
    : SUB_TABS.filter((t) => t.id === "legislation");

  return (
    <div className="space-y-4">
      <SubTabBar
        options={continentTabs}
        active={activeContinent}
        onChange={handleContinentChange}
        wrap
      />

      {countriesInContinent.length > 0 ? (
        <div className="space-y-4">
          <SubTabBar
            options={countryTabs}
            active={activeCountry}
            onChange={handleCountryChange}
            wrap
          />
          {countriesInContinent.includes(activeCountry) && (
            <>
              <SubTabBar
                options={visibleSubTabs}
                active={activeSubTab}
                onChange={setActiveSubTab}
              />

              {activeSubTab === "legislation" && <AdminBillsSection countryId={activeCountry} />}
              {activeSubTab === "cabinet" && <AdminCabinetSection countryId={activeCountry} />}
              {activeSubTab === "leadership" && (
                <AdminLeadershipSection countryId={activeCountry} />
              )}
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted shadow-card">
          No registered countries in {activeContinent} yet.
        </div>
      )}
    </div>
  );
}
