/**
 * USD-normalized national GDP for modelled countries.
 *
 * Its own module because two layers need it and they sit on opposite sides of
 * each other: `entityGdp` builds entity-wide GDP on top of it, and the
 * world-organizations view builds on `entityGdp`. Leaving it in the view made
 * that an import cycle.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { gdpToAnchor, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { aggregateNationalGdp } from "@/lib/utils/nationalGdp";

/**
 * USD-normalized national GDP (millions) for the given countries. `state.gdp`
 * is stored in the unit the era's regional seed authored it in, so cross-country
 * comparison goes through `getGdpAnchorRate` — which is ERA-SCOPED.
 *
 * Reading the base config here (refs #3778) is what made the world-organizations
 * GDP table rank France at ~$3.9T in a 1953 world: frRegions1953 is authored in
 * old francs at 350 FRF/$, and the base config carries FR's 1979 rate of 0.238.
 * `preset` may be supplied by callers that already hold it; otherwise it is read
 * from the `gameState` singleton.
 */
export async function loadUsdGdpByCountry(
  db: Db,
  countries: CountryId[],
  preset?: string
): Promise<Map<CountryId, number>> {
  const result = new Map<CountryId, number>();
  if (countries.length === 0) return result;
  const activePreset = preset ?? (await loadWorldPreset(db));
  const states = await db
    .collection<{ countryId: CountryId; gdp?: number; population: number }>("states")
    .find({ countryId: { $in: countries } })
    .project<{ countryId: CountryId; gdp?: number; population: number }>({
      countryId: 1,
      gdp: 1,
      population: 1,
    })
    .toArray();
  const byCountry = new Map<CountryId, { gdp?: number; population: number }[]>();
  for (const st of states) {
    const list = byCountry.get(st.countryId) ?? [];
    list.push(st);
    byCountry.set(st.countryId, list);
  }
  for (const [countryId, group] of byCountry) {
    const localMillions = aggregateNationalGdp(group).gdpMillions;
    result.set(countryId, gdpToAnchor(localMillions, countryId, activePreset));
  }
  return result;
}
