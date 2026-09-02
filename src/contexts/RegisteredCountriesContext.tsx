"use client";
import { createContext, useContext, type ReactNode } from "react";
import { COUNTRY_ORDER, getCountryDisplayName, type CountryId } from "@/lib/constants/countries";

/**
 * The two runtime country sets, resolved server-side and hydrated into the client
 * tree by the root layout:
 *
 * - `registered` — `COUNTRY_ORDER` plus any country whose `countryGameStates` row is
 *   `status: "active"` (a seceded SCO/WAL). The iteration base for ADMIN tooling, which
 *   manages every country that exists, enabled or not.
 * - `enabled` — the subset that is live for players (`enabledForPlayers`). The base for
 *   PLAYER-FACING country pickers (the nation switcher), so a registered-but-not-yet-enabled
 *   country stays hidden from players until activation flips it on.
 *
 * Both default to the static `COUNTRY_ORDER` when no provider wraps the tree (tests, stray
 * subtrees) so consumers never crash.
 *
 * `preset` is the active reset preset (e.g. "1979-default"), so client surfaces can render
 * era-aware country names — the FRG shows as "West Germany" in 1979 — via
 * `getCountryDisplayName(id, preset)`. Defaults to "2019-default".
 */
export interface CountrySets {
  registered: CountryId[];
  enabled: CountryId[];
  preset: string;
  /**
   * Runtime renames, by country. Empty for every country that still goes by its
   * compiled name — see `useCountryDisplayName`.
   */
  nameOverrides: Partial<Record<CountryId, string>>;
}

const RegisteredCountriesContext = createContext<CountrySets>({
  registered: COUNTRY_ORDER,
  enabled: COUNTRY_ORDER,
  preset: "2019-default",
  nameOverrides: {},
});

export function RegisteredCountriesProvider({
  value,
  children,
}: {
  value: CountrySets;
  children: ReactNode;
}) {
  return (
    <RegisteredCountriesContext.Provider value={value}>
      {children}
    </RegisteredCountriesContext.Provider>
  );
}

/**
 * Client hook for the runtime registered-country set (SSR-hydrated). Use for ADMIN
 * surfaces that manage all countries. Player-facing pickers should use
 * `useEnabledCountries()` instead.
 */
export function useRegisteredCountries(): CountryId[] {
  return useContext(RegisteredCountriesContext).registered;
}

/**
 * Client hook for the player-enabled country set (SSR-hydrated). Use for player-facing
 * country pickers so disabled / not-yet-activated countries stay hidden.
 */
export function useEnabledCountries(): CountryId[] {
  return useContext(RegisteredCountriesContext).enabled;
}

/**
 * Client hook for the active reset preset (SSR-hydrated). Pass it to
 * `getCountryDisplayName(id, preset)` so client surfaces render era-aware country
 * names (e.g. "West Germany" in the 1979 era).
 */
export function useActivePreset(): string {
  return useContext(RegisteredCountriesContext).preset;
}

/**
 * Client hook for what a country should be CALLED right now.
 *
 * `getCountryDisplayName` reads compiled seed data plus era aliases, so it
 * cannot know a country was renamed at runtime — after a reunification the
 * surviving shell went on calling itself "East Germany" in the navbar, the
 * nation switcher and the world cards, while the server-rendered country pages
 * (which can reach `resolveCountryIdentity`) called it Germany. Two names for one
 * country, decided by which surface a player happened to be looking at.
 *
 * Use this ANYWHERE a client component names a country. The era alias still
 * applies underneath: an override answers "what is this country now", the preset
 * answers "what was it called in this year", and only the first can contradict
 * the compiled data.
 */
export function useCountryDisplayName(): (id: CountryId) => string {
  const { preset, nameOverrides } = useContext(RegisteredCountriesContext);
  return (id: CountryId) => nameOverrides[id] ?? getCountryDisplayName(id, preset);
}
