/**
 * Ruble transition rules (portable rules core).
 *
 * Pure data in, plain data out: no database, wall clock, randomness,
 * environment, network, or app-layer imports. The shells (seeders, turn
 * phases) load documents, call these helpers, and write results back.
 *
 * RATE BASIS. Russia's 2027 USD/RUB anchor is an explicit fallback derived
 * from the authored 2027 country data, not a 2027 observation: `RU_2027`
 * carries `usdExchangeRate: 0.01081` USD per ruble, implied by the 2024
 * anchors (World Bank nominal GDP USD 2,173,836M over Rosstat 2024 GDP RUB
 * 201,152,000M). Inverting gives 1 / 0.01081 = 92.506 RUB per USD, rounded
 * to one decimal for the seed table. See `src/lib/countries/ru/eras/2027.ts`.
 *
 * PRESET GATING. Only the 2027-default preset starts on the modern ruble
 * (RUB). Every helper takes the preset id explicitly and passes non-RUB
 * presets through untouched, so Cold War, 1991, and every other world keep
 * the Soviet ruble (SUR) byte-identically to before. SUR and RUB never
 * co-circulate in one world, so no SUR/RUB conversion factor exists here.
 */

export const RU_2027_USD_PER_RUB = 0.01081;

/** Local currency per 1 internal unit for RU in a 2027-default world. */
export const RU_2027_RUB_PER_USD = 92.5;

/** Presets whose fresh bootstrap starts Russia on the modern ruble. */
const RUB_PRESETS: ReadonlySet<string> = new Set(["2027-default"]);

/** True when a fresh world of `preset` starts `countryId` on the ruble. */
export function isRubleAdopted(countryId: string, preset: string): boolean {
  if (!RUB_PRESETS.has(preset)) return false;
  return countryId === "RU";
}
