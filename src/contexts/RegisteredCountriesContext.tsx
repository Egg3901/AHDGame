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
 *
 * `displayOverrides` is the RUNTIME identity layer, hydrated from `countryState` next to
 * the sets above. A country renamed or reflagged by a runtime event (a reunification
 * writes `displayNameOverride: "Germany"` on the surviving shell) must not keep
 * introducing itself under its compiled name: the nav dropdowns, the nation switcher and
 * the /world cards are client components and read their names HERE, not from the resolver
 * the server surfaces use. Keyed by country id; absent key (the overwhelmingly common
 * case) means "no runtime event has touched this country" and the compiled/era name
 * stands. `getCountryDisplayNameWithOverrides` applies them.
 */
export interface CountryDisplayOverrides {
  /** displayNameOverride from `countryState`, when a runtime event renamed the country. */
  name?: string | null;
  /** flagEmojiOverride from `countryState`, on the same terms. */
  flagEmoji?: string | null;
}

export interface CountrySets {
  registered: CountryId[];
  enabled: CountryId[];
  preset: string;
  /** Runtime name/flag overrides, resolved server-side. Empty until hydrated. */
  displayOverrides?: Record<string, CountryDisplayOverrides>;
}

export const RegisteredCountriesContext = createContext<CountrySets>({
  registered: COUNTRY_ORDER,
  enabled: COUNTRY_ORDER,
  preset: "2019-default",
  displayOverrides: {},
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
 * The runtime display layer for CLIENT country names: era alias first, then the
 * runtime override a rename/reunification event wrote.
 *
 * Server surfaces answer this through `resolveCountryIdentity`; client components
 * cannot call it (it reads the database), so the root layout hydrates the same
 * overrides into the context and this hook layers them over
 * `getCountryDisplayName` in the same order the resolver uses. Without the
 * override layer a reunified Germany went on being announced as "East Germany"
 * in the nav dropdown and on the /world cards, on every page, for ever
 * (ticket #1255).
 */
export function getCountryDisplayNameWithOverrides(
  id: CountryId,
  preset: string,
  displayOverrides: Record<string, CountryDisplayOverrides> | undefined
): string {
  return displayOverrides?.[id]?.name ?? getCountryDisplayName(id, preset);
}

/** The same layering as a hook, for components already inside the provider. */
export function useCountryDisplayName(id: CountryId): string {
  const { preset, displayOverrides } = useContext(RegisteredCountriesContext);
  return getCountryDisplayNameWithOverrides(id, preset, displayOverrides);
}
