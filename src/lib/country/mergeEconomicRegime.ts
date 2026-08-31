/**
 * The absorbed country's ECONOMIC regime carries onto the survivor.
 *
 * The German Question's challenger outcome converts the political system
 * (`installOnePartyState`) — but the command economy is a separate, per-country
 * dial (`marketizationLevel`), and without this step a victorious SED would
 * find itself ruling West Germany's market machinery: floating currency,
 * Taylor-rule chair, hard budgets, no Gosplan. The winner's regime is part of
 * the settlement, so the stored dial (and any player Gosbank directive) moves
 * with the state.
 *
 * ONE-DIRECTIONAL: the carry only ever makes the survivor MORE planned. A
 * merge where the absorbed side was the more market economy (some future use of
 * this pipeline) must not "reform" the survivor as a side effect of absorbing
 * it — regime change is the settlement's job, not the bookkeeping's.
 *
 * The write is the persisted `federalBudget.economicFactors.marketizationLevel`
 * plus the in-process registry (`setStoredMarketizationLevel`), so every later
 * phase of the SAME turn already sees the carried regime. The turn-boundary
 * hydration in `commandEconomyTurn` re-reads the persisted field — which is why
 * that hydration trusts the stored value over the compiled schedule.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  scheduledMarketizationLevel,
  setStoredMarketizationLevel,
} from "@/lib/constants/commandEconomy";

export interface MergeEconomicRegimeArgs {
  fromCountryId: CountryId;
  toCountryId: CountryId;
  /** The in-game year, for the schedule fallback when nothing is stored. */
  currentYear: number;
}

export interface MergeEconomicRegimeResult {
  regimeCarried: boolean;
  /** The level the survivor ended on (whichever side it came from). */
  survivorLevel: number;
}

export async function mergeEconomicRegime(
  db: Db,
  args: MergeEconomicRegimeArgs
): Promise<MergeEconomicRegimeResult> {
  const { fromCountryId, toCountryId, currentYear } = args;
  const budgets = db.collection<FederalBudget>("federalBudget");

  const [from, to] = await Promise.all([
    budgets.findOne({ _id: fromCountryId }),
    budgets.findOne({ _id: toCountryId }),
  ]);

  const levelOf = (doc: FederalBudget | null, countryId: CountryId): number => {
    const stored = doc?.economicFactors?.marketizationLevel;
    if (typeof stored === "number" && Number.isFinite(stored)) return stored;
    return scheduledMarketizationLevel(countryId, currentYear);
  };

  const fromLevel = levelOf(from, fromCountryId);
  const toLevel = levelOf(to, toCountryId);

  if (fromLevel >= toLevel) {
    return { regimeCarried: false, survivorLevel: toLevel };
  }

  const set: Record<string, unknown> = {
    "economicFactors.marketizationLevel": fromLevel,
    updatedAt: new Date(),
  };
  // A player Gosbank chair's standing directive is part of the regime being
  // carried; absent, the survivor's NPP brain derives its own stance.
  const directive = from?.economicFactors?.gosbankDirective;
  if (directive) set["economicFactors.gosbankDirective"] = directive;

  await budgets.updateOne({ _id: toCountryId }, { $set: set });
  // Same-turn visibility: phases after the actuation read the registry, not the DB.
  setStoredMarketizationLevel(toCountryId, fromLevel);

  return { regimeCarried: true, survivorLevel: fromLevel };
}
