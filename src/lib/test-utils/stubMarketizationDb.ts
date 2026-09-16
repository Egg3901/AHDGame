import type { Db } from "mongodb";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Minimal `Db` stub serving exactly the two reads
 * `loadPrivateEnterpriseBlockedCountries` performs: the current `gameState`
 * year, and `federalBudget` rows carrying `economicFactors.marketizationLevel`.
 *
 * Countries absent from `levels` return no budget row, so the era-schedule
 * fallback is exercised without needing a separate fixture.
 *
 * With no `base`, it THROWS on any other collection by design: a test that
 * reaches that error rather than a gate refusal has proved the gate permitted the
 * country and execution continued past it.
 *
 * Pass `base` (e.g. a `createMockDb()`) to layer the marketization reads over a
 * fuller stub, for call sites that touch other collections before or after the
 * gate runs.
 */
export function stubMarketizationDb(opts: {
  currentYear: number | null;
  levels?: Partial<Record<CountryId, number>>;
  base?: Db;
}): Db {
  const rows = Object.entries(opts.levels ?? {}).map(([id, level]) => ({
    _id: getNationalBudgetId(id as CountryId),
    economicFactors: { marketizationLevel: level },
  }));
  return {
    collection(name: string) {
      if (name === "gameState") {
        return { findOne: async () => ({ _id: "current", currentYear: opts.currentYear }) };
      }
      if (name === "federalBudget") {
        return { find: () => ({ toArray: async () => rows }) };
      }
      if (opts.base) return opts.base.collection(name);
      throw new Error(`stubMarketizationDb: unexpected collection ${name}`);
    },
  } as unknown as Db;
}
