import { COUNTRY_CONFIGS, type CountryId, type CountryStatus } from "./constants/countries";

export interface CountryAccessSnapshot {
  enabledForPlayers: boolean;
  status: CountryStatus;
  economyPreview: boolean;
  /**
   * Whether the country exists in the runtime registered set. Optional so the
   * call sites that only carry the three legacy fields keep compiling; omitted
   * means "registered", which is what every country reachable from
   * `getAllCountryAccess` is.
   */
  registered?: boolean;
}

export type CountryAvailabilityState = "playable" | "beta-access" | "econ-only" | "hidden";

export type CountryAvailabilityTone = "active" | "beta" | "planned";

export type CountryAccessMode = "full" | "econ-only" | "hidden";

export interface CountryAvailability {
  countryId: CountryId;
  status: CountryStatus;
  enabledForPlayers: boolean;
  economyPreview: boolean;
  accessMode: CountryAccessMode;
  displayState: CountryAvailabilityState;
  tone: CountryAvailabilityTone;
  label: string;
  isClickable: boolean;
  preferredPath: string | null;
  sortOrder: number;
}

/**
 * Resolve what a player may do with a country.
 *
 * Three outcomes, not five. A country is either playable (you can act), an
 * econ-only nation (you can browse every page, political ones included, but you
 * cannot act), or hidden because it is not registered and so has no seeded
 * world to show.
 *
 * The old `economy-preview` / `planned` / `under-development` states collapsed
 * into `econ-only`: they differed in badge copy while behaving identically for
 * the player, and two of them advertised political pages as unavailable when
 * `/country/[code]/layout.tsx` was already rendering them read-only.
 */
export function resolveCountryAvailability(
  countryId: CountryId,
  access: CountryAccessSnapshot
): CountryAvailability {
  const config = COUNTRY_CONFIGS[countryId];

  if (access.enabledForPlayers) {
    if (access.status === "beta") {
      return {
        countryId,
        status: access.status,
        enabledForPlayers: access.enabledForPlayers,
        economyPreview: access.economyPreview,
        accessMode: "full",
        displayState: "beta-access",
        tone: "beta",
        label: "Beta Access",
        isClickable: true,
        preferredPath: config.overviewPath,
        sortOrder: 0,
      };
    }

    return {
      countryId,
      status: access.status,
      enabledForPlayers: access.enabledForPlayers,
      economyPreview: access.economyPreview,
      accessMode: "full",
      displayState: "playable",
      tone: "active",
      label: "Active",
      isClickable: true,
      preferredPath: config.overviewPath,
      sortOrder: 1,
    };
  }

  // Unregistered — a latent secession target (SCO/WAL) before activation. There
  // is no seeded world behind it, so it stays dark.
  if (access.registered === false) {
    return {
      countryId,
      status: access.status,
      enabledForPlayers: access.enabledForPlayers,
      economyPreview: access.economyPreview,
      accessMode: "hidden",
      displayState: "hidden",
      tone: "planned",
      label: "Under Development",
      isClickable: false,
      preferredPath: null,
      sortOrder: 4,
    };
  }

  return {
    countryId,
    status: access.status,
    enabledForPlayers: access.enabledForPlayers,
    economyPreview: access.economyPreview,
    accessMode: "econ-only",
    displayState: "econ-only",
    tone: "planned",
    label: "Econ-Only",
    isClickable: true,
    // The overview, not the map. It is the front door to everything the country
    // has, and every page under it now renders.
    preferredPath: config.overviewPath,
    sortOrder: 2,
  };
}
