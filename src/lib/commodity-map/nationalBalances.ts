/**
 * Helpers for reading the authoritative per-country commodity supply/demand
 * stored on each CommodityPrice document.
 *
 * During commodityPriceTurn the turn processor sums sector and HQ flows into
 * per-country buckets, then injects federal demand (e.g. government healthcare
 * spending) that only lands in the national bucket — not in any state. The
 * resulting totals are persisted as `nationalSupply` / `nationalDemand` on
 * each CommodityPrice row.
 *
 * Consumers that reconstruct national balances by summing `stateSupply` /
 * `stateDemand` across states will undercount any demand that was injected
 * after the state→country rollup (today: federal healthcare, potentially more
 * later). Always prefer the stored national fields via the helpers here; fall
 * back to the state sum only when the stored fields are missing (older saves
 * written before the fields existed).
 */

type NationalLike = {
  nationalSupply?: Record<string, number>;
  nationalDemand?: Record<string, number>;
  stateSupply: Record<string, number>;
  stateDemand: Record<string, number>;
};

export type CommodityBalance = { supply: number; demand: number };

/**
 * Returns {supply, demand} for the given country, preferring the stored
 * national fields over a state-sum fallback.
 */
export function getNationalCommodityBalance(
  cp: NationalLike,
  countryId: string,
  stateCountryMap: ReadonlyMap<string, string>
): CommodityBalance {
  const storedSupply = cp.nationalSupply?.[countryId];
  const storedDemand = cp.nationalDemand?.[countryId];
  if (storedSupply !== undefined || storedDemand !== undefined) {
    return {
      supply: storedSupply ?? 0,
      demand: storedDemand ?? 0,
    };
  }

  let supply = 0;
  let demand = 0;
  for (const [stateId, cid] of stateCountryMap) {
    if (cid !== countryId) continue;
    supply += cp.stateSupply[stateId] ?? 0;
    demand += cp.stateDemand[stateId] ?? 0;
  }
  return { supply, demand };
}

/**
 * Returns a Map<countryId, {supply, demand}> for every country that appears
 * either in the stored national fields or in the state→country map.
 */
export function buildNationalCommodityBalances(
  cp: NationalLike,
  stateCountryMap: ReadonlyMap<string, string>
): Map<string, CommodityBalance> {
  const result = new Map<string, CommodityBalance>();

  const storedSupply = cp.nationalSupply;
  const storedDemand = cp.nationalDemand;
  const hasStored =
    (storedSupply && Object.keys(storedSupply).length > 0) ||
    (storedDemand && Object.keys(storedDemand).length > 0);

  if (hasStored) {
    const countries = new Set<string>([
      ...Object.keys(storedSupply ?? {}),
      ...Object.keys(storedDemand ?? {}),
    ]);
    for (const cid of countries) {
      result.set(cid, {
        supply: storedSupply?.[cid] ?? 0,
        demand: storedDemand?.[cid] ?? 0,
      });
    }
    return result;
  }

  for (const [stateId, countryId] of stateCountryMap) {
    if (!result.has(countryId)) {
      result.set(countryId, { supply: 0, demand: 0 });
    }
    const bal = result.get(countryId)!;
    bal.supply += cp.stateSupply[stateId] ?? 0;
    bal.demand += cp.stateDemand[stateId] ?? 0;
  }
  return result;
}
