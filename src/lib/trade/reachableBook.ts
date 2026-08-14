import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { ClearingResult } from "./types";
import { reachableDemandUnits } from "@/lib/market/tradePartition";

/**
 * Per-country, per-commodity REACHABLE market book, in commodity units.
 *
 * Ticket #1077. Every player-facing "is there room in this market" signal used
 * to read the GLOBAL aggregate (`globalDemand - globalSupply`). That number sums
 * three populations of supply that cannot substitute for one another:
 *
 *   1. reachable  - normal trade partners
 *   2. blocked    - real output sitting behind an embargo wall
 *   3. untraded   - output from countries outside `COUNTRY_ORDER`, which the
 *                   clearing engine never sees, so it reaches NO market at all
 *
 * Measured on prod at turn 97: world oil read 0.82 demand/supply, so the build
 * gate reported "oversupplied, 0 room" everywhere, while the book a US seller
 * actually faces ran 1.82 - because the surplus was Soviet oil the US
 * embargoes. World steel supply was 41% Ukrainian, from a country that trades
 * with nobody.
 *
 * `supply` and `demand` are the numbers to do arithmetic with. `blockedSupply`
 * and `untradedSupply` are DISCLOSURE ONLY: they exist so the UI can name what
 * it excluded ("World supply 3,355,598. Reachable from the US: 1,246,505.
 * Embargoed: 696,494. Untraded: 1,412,598.") instead of showing a bare 0 that
 * reads as a dead market. Never add them back into a ratio.
 */
export interface ReachableBookEntry {
  /** What this country's own producers collectively made (S_H). */
  supply: number;
  /** Demand its producers can actually sell into. See `reachableDemandUnits`. */
  demand: number;
  /** Units imported, which is demand already served by someone else. */
  imports: number;
  /** Units exported, which is demand reached abroad. */
  exports: number;
  /** Disclosure: world supply an embargo keeps out of this country. */
  blockedSupply: number;
  /** Disclosure: world supply from countries that trade with nobody. */
  untradedSupply: number;
}

export type ReachableBooks = Map<CountryId, Map<CommodityType, ReachableBookEntry>>;

/** Mongo-serialisable form of {@link ReachableBooks} (Maps do not persist). */
export type ReachableBooksDoc = Partial<
  Record<string, Partial<Record<CommodityType, ReachableBookEntry>>>
>;

export interface BuildReachableBooksArgs {
  /** Trading countries, i.e. `COUNTRY_ORDER`. Ids outside this list are untraded. */
  countries: CountryId[];
  /**
   * PRE-convergence national balances, keyed by EVERY country id present in the
   * ledger including untraded ones. Must be the same balances `clearing` was
   * computed on: `applyTradeConvergence` mutates them in place afterwards, and
   * reading the post-mutation values here would understate every deficit by the
   * convergence factor.
   */
  balances: ReadonlyMap<string, ReadonlyMap<CommodityType, { supply: number; demand: number }>>;
  /** Clearing results in UNITS, from `clearAllCommodities`. */
  clearing: ReadonlyMap<CommodityType, ClearingResult>;
  /** Commodities to build books for. */
  commodities: readonly CommodityType[];
  /**
   * True when an embargo blocks `exporter -> importer` for this commodity. The
   * engine's convention is `affinityFor(...) === 0`, which is what the sourcing
   * pass already uses.
   */
  isBlocked: (commodity: CommodityType, exporter: CountryId, importer: CountryId) => boolean;
}

export function buildReachableBooks(args: BuildReachableBooksArgs): ReachableBooks {
  const { countries, balances, clearing, commodities, isBlocked } = args;

  const trading = new Set<string>(countries);
  const books: ReachableBooks = new Map();
  for (const c of countries) books.set(c, new Map());

  for (const commodity of commodities) {
    // Supply that reaches no market at all, identical for every viewer: it is
    // absent from the clearing engine, not merely walled off from one country.
    let untradedSupply = 0;
    for (const [countryId, byCommodity] of balances) {
      if (trading.has(countryId)) continue;
      untradedSupply += byCommodity.get(commodity)?.supply ?? 0;
    }

    const result = clearing.get(commodity);

    for (const home of countries) {
      const bal = balances.get(home)?.get(commodity);
      const supply = bal?.supply ?? 0;
      const demand = bal?.demand ?? 0;
      const pc = result?.perCountry[home];
      const imports = pc?.imports ?? 0;
      const exports = pc?.exports ?? 0;

      let blockedSupply = 0;
      for (const other of countries) {
        if (other === home) continue;
        if (!isBlocked(commodity, other, home)) continue;
        blockedSupply += balances.get(other)?.get(commodity)?.supply ?? 0;
      }

      books.get(home)!.set(commodity, {
        supply,
        demand: reachableDemandUnits(demand, imports, exports),
        imports,
        exports,
        blockedSupply,
        untradedSupply,
      });
    }
  }

  return books;
}

/** Flatten to plain objects for persistence. */
export function serializeReachableBooks(books: ReachableBooks): ReachableBooksDoc {
  const out: ReachableBooksDoc = {};
  for (const [countryId, byCommodity] of books) {
    const entry: Partial<Record<CommodityType, ReachableBookEntry>> = {};
    for (const [commodity, book] of byCommodity) entry[commodity] = book;
    out[countryId] = entry;
  }
  return out;
}

/**
 * Unmet demand in a country's reachable book, in units. Zero when the book is
 * saturated or in glut. This is the per-country replacement for the old
 * `max(0, globalDemand - globalSupply)`.
 */
export function reachableDemandGap(book: ReachableBookEntry | undefined): number {
  if (!book) return 0;
  return Math.max(0, book.demand - book.supply);
}
