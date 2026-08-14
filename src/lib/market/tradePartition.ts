import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import { clearCommodity } from "@/lib/trade/clearing";

/**
 * Per-country order books for the corporate clearing pass.
 *
 * The corporate clearing engine (`computeClearingFactors`) historically ran ONE
 * worldwide book per commodity: every seller on the planet was a pro-rata
 * claimant on global lagged demand, so a Donbas kombinat and a Connecticut mill
 * competed in the same steel book with no iron curtain between them. These
 * books scope each seller to the demand its home country can actually REACH
 * under the live trade-policy graph — embargoes block, tariffs and geography
 * drag, embargo caps clamp — by reusing the same gravity clearing
 * (`clearCommodity` + `buildTradeAffinity`) that already produces the world
 * trade snapshot each turn.
 *
 * For a country H and commodity c, over the LAGGED national balances:
 *
 *   book.supply = S_H                       (what H's sellers collectively made)
 *   book.demand = max(0, D_H − imports_H) + exports_H
 *
 * i.e. the domestic demand H's producers keep after import competition, plus
 * the export volume the trade graph lets them place abroad. A country whose
 * surplus cannot leave (embargoed, autarkic, tariff-walled) sees its book
 * demand pinned at reachable volume and its sellers' fills fall — instead of
 * quietly exporting the glut into every open economy on Earth.
 *
 * Pure: consumes lagged balances and affinity functions, no DB.
 */
export type CountryClearingBooks = Map<
  CountryId,
  Map<CommodityType, { supply: number; demand: number }>
>;

/**
 * The sellable demand a country's producers face, in units.
 *
 * ONE definition, shared by the engine's clearing books and by every
 * player-facing surface that quotes market room (`lib/trade/reachableBook`).
 * The build gates used to read `globalDemand - globalSupply` instead, which
 * summed across embargo walls and across countries that trade with nobody, and
 * told US players a market was oversupplied when the market they could reach
 * ran a shortage (ticket #1077). If the quote and the clearing disagree the
 * quote is worse than no quote, so neither side gets its own copy of this.
 */
export function reachableDemandUnits(demand: number, imports: number, exports: number): number {
  return Math.max(0, demand - imports) + exports;
}

export function buildCountryClearingBooks(args: {
  countries: CountryId[];
  /** Lagged per-country balances (prior turn's ledger), in units. */
  nationalBalances: ReadonlyMap<
    CountryId,
    ReadonlyMap<CommodityType, { supply: number; demand: number }>
  >;
  affinityFor: (commodity: CommodityType, exporter: CountryId, importer: CountryId) => number;
  capUnitsFor?: (
    commodity: CommodityType,
    exporter: CountryId,
    importer: CountryId
  ) => number | undefined;
}): CountryClearingBooks {
  const { countries, nationalBalances, affinityFor, capUnitsFor } = args;

  const books: CountryClearingBooks = new Map();
  for (const c of countries) {
    books.set(c, new Map());
  }

  for (const commodity of COMMODITY_TYPES) {
    const supply: Partial<Record<CountryId, number>> = {};
    const demand: Partial<Record<CountryId, number>> = {};
    let any = false;
    for (const c of countries) {
      const bal = nationalBalances.get(c)?.get(commodity);
      supply[c] = bal?.supply ?? 0;
      demand[c] = bal?.demand ?? 0;
      if ((supply[c] ?? 0) > 0 || (demand[c] ?? 0) > 0) any = true;
    }
    if (!any) continue;

    const result = clearCommodity({
      countries,
      supply,
      demand,
      affinity: (e, i) => affinityFor(commodity, e, i),
      capUnits: capUnitsFor ? (e, i) => capUnitsFor(commodity, e, i) : undefined,
    });

    for (const c of countries) {
      const s = supply[c] ?? 0;
      const d = demand[c] ?? 0;
      const pc = result.perCountry[c];
      const imports = pc?.imports ?? 0;
      const exports = pc?.exports ?? 0;
      books.get(c)!.set(commodity, {
        supply: s,
        demand: reachableDemandUnits(d, imports, exports),
      });
    }
  }

  return books;
}
