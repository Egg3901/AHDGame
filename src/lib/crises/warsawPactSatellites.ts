import type { CountryId } from "@/lib/constants/countries";

/**
 * Warsaw Pact satellite states as playable/simulated countries in this game
 * (the Soviet Union itself is "RU"). Used to scope the Prague-Spring-style
 * liberalization crisis family and its cascade follow-ups. Kept as its own
 * module so both `templates.ts` and `optionActions.ts` can read it without a
 * cycle.
 */
export const WARSAW_PACT_SATELLITE_COUNTRY_IDS: CountryId[] = ["PL", "DD", "CS", "BG", "HU", "RO"];

export const USSR_COUNTRY_ID: CountryId = "RU";

/** USSR plus every satellite — the full bloc a Prague-Spring-style reform
 *  movement can be scoped to. */
export const WARSAW_PACT_BLOC_COUNTRY_IDS: CountryId[] = [
  USSR_COUNTRY_ID,
  ...WARSAW_PACT_SATELLITE_COUNTRY_IDS,
];
