/**
 * Regional government demand. distributeDemandToStates assigns a country's
 * supported demand to its states by GDP, or evenly when GDP is unavailable.
 */
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";

type Balance = { supply: number; demand: number };

export function distributeDemandToStates(args: {
  countryId: string;
  commodity: CommodityType;
  units: number;
  statesByCountry: ReadonlyMap<string, ReadonlyMap<string, number>>;
  stateToCountry: ReadonlyMap<string, string>;
  byState: Map<string, Map<CommodityType, Balance>>;
}): void {
  const { countryId, commodity, units, statesByCountry, stateToCountry, byState } = args;
  const targets: Array<[string, number]> = [];
  const shares = statesByCountry.get(countryId);
  if (shares?.size) {
    const total = [...shares.values()].reduce((sum, value) => sum + value, 0);
    const fallbackShare = units / shares.size;
    for (const [stateId, gdp] of shares) {
      targets.push([stateId, total > 0 ? units * (gdp / total) : fallbackShare]);
    }
  } else {
    const ids = [...stateToCountry]
      .filter(([, id]) => id === countryId)
      .map(([stateId]) => stateId);
    if (ids.length === 0) return;
    for (const stateId of ids) targets.push([stateId, units / ids.length]);
  }

  for (const [stateId, share] of targets) {
    if (!(share > 0)) continue;
    let stateMap = byState.get(stateId);
    if (!stateMap) {
      stateMap = new Map(COMMODITY_TYPES.map((type) => [type, { supply: 0, demand: 0 }]));
      byState.set(stateId, stateMap);
    }
    stateMap.get(commodity)!.demand += share;
  }
}
