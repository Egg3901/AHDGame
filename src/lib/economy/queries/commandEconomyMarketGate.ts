/**
 * Command Economy (market-visibility gate) — which countries' corporate
 * markets (unowned pools especially) should NOT be offered to a PRIVATE
 * corporation right now, because the state owns production there.
 *
 * Two independent, already-canonical signals feed this — deliberately not a
 * new predicate or a hardcoded country list:
 *
 *  1. STRUCTURAL — `COUNTRY_CONFIGS[id].disallowPrivateCorporationFounding`.
 *     Always-on, no feature flag, no year dependency. This is the SAME flag
 *     `POST /api/corporations` already checks to block founding a new private
 *     corp in these countries ("Private corporations cannot be founded in a
 *     command economy. The state controls all enterprise."). RU (USSR), DD,
 *     PL, HU, CS, BG, RO, YU and the union republics UKR/BLR/BAL never have a
 *     market-economy era in this game (they're Eastern-Bloc-only seeds), so the
 *     flag is unconditional for them.
 *
 *  2. DYNAMIC — the marketization DIAL (`isCommandEconomy` /
 *     `marketizationLevel` in `@/lib/constants/commandEconomy`), for a country
 *     that migrates ACROSS a command phase within its own playable timeline
 *     (CN: 1953 command → 1993+ market). Gated behind the `commandEconomyEnabled`
 *     GameConfig flag (default off), so flag-off worlds are byte-identical.
 *     Reads the PERSISTED live level (`FederalBudget.economicFactors.
 *     marketizationLevel`) when present — same read pattern as
 *     `loadCommandEconomyDashboard` — so a country that has liberalized past
 *     `COMMAND_CEILING` (scripted schedule or v2 endogenous drift) correctly
 *     stops being gated. Falls back to the era schedule when nothing is
 *     persisted yet.
 *
 * Fail-open on the dynamic signal: a DB hiccup here should degrade to "flag
 * behaves as off" rather than false-blocking a live game's markets. The
 * structural signal never touches the DB, so it can't fail open/closed.
 */

import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import {
  COMMAND_CEILING,
  MARKETIZATION_SCHEDULE,
  scheduledMarketizationLevel,
} from "@/lib/constants/commandEconomy";
import type { FederalBudget, GameConfig, GameState } from "@/lib/db/types";

/**
 * Resolve the set of `countryIds` (out of the ones passed in) whose corporate
 * market is currently state-controlled and should not be offered to private
 * corporations. Only looks at the countries actually passed in — cheap to
 * call with a handful of candidate countries from a suggestions/expansion query.
 */
export async function loadCommandEconomyBlockedCountries(
  db: Db,
  countryIds: Iterable<string | null | undefined>
): Promise<Set<CountryId>> {
  const blocked = new Set<CountryId>();
  const dynamicCandidates: CountryId[] = [];

  const seen = new Set<string>();
  for (const raw of countryIds) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const id = raw as CountryId;
    if (!COUNTRY_CONFIGS[id]) continue;
    if (COUNTRY_CONFIGS[id].disallowPrivateCorporationFounding) {
      blocked.add(id);
    } else if (MARKETIZATION_SCHEDULE[id]) {
      dynamicCandidates.push(id);
    }
  }

  if (dynamicCandidates.length === 0) return blocked;

  try {
    const [gameConfig, gameState] = await Promise.all([
      db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentYear: 1 } }),
    ]);
    const enabled = gameConfig?.commandEconomyEnabled === true;
    if (!enabled) return blocked;

    const currentYear = gameState?.currentYear ?? null;
    const budgetIds = dynamicCandidates.map((id) => getNationalBudgetId(id));
    const budgets = await db
      .collection<FederalBudget>("federalBudget")
      .find(
        { _id: { $in: budgetIds } },
        { projection: { "economicFactors.marketizationLevel": 1 } }
      )
      .toArray();
    const persistedByBudgetId = new Map(
      budgets.map((b) => [b._id, b.economicFactors?.marketizationLevel])
    );

    for (const id of dynamicCandidates) {
      const persisted = persistedByBudgetId.get(getNationalBudgetId(id));
      const level =
        typeof persisted === "number" && Number.isFinite(persisted)
          ? persisted
          : scheduledMarketizationLevel(id, currentYear);
      if (level < COMMAND_CEILING) blocked.add(id);
    }
  } catch {
    // Fail-open: dynamic signal degrades to "not blocked" on any DB error.
    return blocked;
  }

  return blocked;
}
