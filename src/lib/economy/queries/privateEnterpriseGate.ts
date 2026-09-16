/**
 * Creation-side gate: may a PRIVATE corporation come into existence in, or take
 * ownership of production in, this country RIGHT NOW?
 *
 * The authority is the marketization DIAL, never a per-country boolean. A
 * country that converts INTO a command economy is blocked on the next read; one
 * that converts OUT is released the same way. No code change, no redeploy, and
 * one place to edit (`MARKETIZATION_SCHEDULE`) when a regime changes.
 *
 * This replaced `CountryConfig.disallowPrivateCorporationFounding`, which was
 * redundant with the schedule and could only ever diverge from it: every flagged
 * country was already scheduled, while BLR/BAL/UKR and CN were scheduled but
 * unflagged, so a flag-based gate silently permitted private enterprise in the
 * union republics and in command-era China.
 *
 * Two deliberate departures from `isCommandEconomy(countryId, year, enabled)`:
 *
 *  1. It does NOT consult `commandEconomyEnabled`. That flag gates the
 *     simulation subsystems (forex, administered CPI, monobank), whereas
 *     "is this a planned economy" is world data. Honouring it would mean
 *     switching the flag off re-opens private founding inside the USSR.
 *  2. It fails CLOSED. `commandEconomyMarketGate` answers the MARKET-visibility
 *     question and fails open by design so a DB hiccup cannot false-block a live
 *     game's expansion. Creation is the opposite trade: a hiccup must not mint a
 *     private corporation inside a planned economy.
 *
 * The threshold is `COMMAND_CEILING`: fully command blocks, dual-track and above
 * permits. That is the band's stated meaning - dual-track runs the plan and
 * market engines in parallel, and private enterprise is the market half.
 */

import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  MARKETIZATION_SCHEDULE,
  scheduledMarketizationLevel,
} from "@/lib/constants/commandEconomy";
import { isPrivateEnterprisePermittedAtLevel } from "./privateEnterpriseRegime";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget, GameState } from "@/lib/db/types";

export class PrivateEnterpriseBlockedError extends Error {
  readonly countryId: string;
  constructor(countryId: string) {
    super(
      "Private corporations cannot be founded in a command economy. The state controls all enterprise."
    );
    this.name = "PrivateEnterpriseBlockedError";
    this.countryId = countryId;
  }
}

// The pure predicates live in `privateEnterpriseRegime` so a client component can
// import them without dragging the Mongo driver in through this module's
// `getNationalBudgetId` dependency. Re-exported for server callers' convenience.
export {
  isPrivateEnterprisePermittedAtLevel,
  privateEnterpriseBlockedByYear,
} from "./privateEnterpriseRegime";

/**
 * The live blocked set for every registered country: the persisted
 * `economicFactors.marketizationLevel` where present, else the era schedule.
 *
 * Resolve ONCE per sweep and reuse - this is one `gameState` read plus one
 * `federalBudget` `$in`, regardless of how many countries are registered.
 */
export async function loadPrivateEnterpriseBlockedCountries(db: Db): Promise<Set<CountryId>> {
  const ids = Object.keys(COUNTRY_CONFIGS) as CountryId[];

  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
  const currentYear = gameState?.currentYear ?? null;

  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find(
      { _id: { $in: ids.map((id) => getNationalBudgetId(id)) } },
      { projection: { "economicFactors.marketizationLevel": 1 } }
    )
    .toArray();
  const persistedByBudgetId = new Map(
    budgets.map((b) => [b._id, b.economicFactors?.marketizationLevel])
  );

  const blocked = new Set<CountryId>();
  for (const id of ids) {
    // ONLY a country modelled as planned (i.e. carrying a marketization
    // trajectory) may be blocked, and only such a country's PERSISTED level is
    // trusted.
    //
    // Without this guard a stray persisted value on a market economy blocks it
    // outright: live prod carries `DE.economicFactors.marketizationLevel =
    // 0.0919`, which is noise from an unrelated write, and reading it would have
    // closed West Germany to private enterprise entirely. The previous gate was
    // accidentally immune because it only ever considered scheduled countries as
    // dynamic candidates; this makes that protection explicit rather than
    // incidental.
    if (!MARKETIZATION_SCHEDULE[id]) continue;

    const persisted = persistedByBudgetId.get(getNationalBudgetId(id));
    const level =
      typeof persisted === "number" && Number.isFinite(persisted)
        ? persisted
        : scheduledMarketizationLevel(id, currentYear);
    if (!isPrivateEnterprisePermittedAtLevel(level)) blocked.add(id);
  }
  return blocked;
}

/**
 * Split market rows into those sited in a country that permits private
 * enterprise and those that do not, returning the blocked set alongside so the
 * caller can re-check individual rows without a second lookup.
 *
 * Exists so the NPP corporate sweep can filter its candidate markets at the
 * SOURCE. That sweep derives several indexes from one list (`unownedByCountry`,
 * `unownedIndex`, a per-country pool index at the draw site); filtering one and
 * leaving another is how a planned market stays reachable. Roughly 80 of the 92
 * sectors that leaked into command economies on the live world arrived through
 * that sweep rather than through founding.
 *
 * Reads the marketization dial, so a country converting into a command economy
 * stops being a candidate on the next turn and one converting out becomes a
 * candidate again, with no code change at the call site.
 */
export async function partitionOpenMarkets<T extends { countryId: string }>(
  db: Db,
  rows: readonly T[]
): Promise<{ open: T[]; blocked: Set<CountryId> }> {
  const blocked = await loadPrivateEnterpriseBlockedCountries(db);
  return { open: rows.filter((r) => !blocked.has(r.countryId as CountryId)), blocked };
}

/**
 * Boolean form, for call sites that return a validation result rather than
 * throwing. Fails closed: any lookup failure reports blocked.
 */
export async function isPrivateEnterpriseBlocked(db: Db, countryId: string): Promise<boolean> {
  try {
    return (await loadPrivateEnterpriseBlockedCountries(db)).has(countryId as CountryId);
  } catch {
    return true;
  }
}

/**
 * Throws `PrivateEnterpriseBlockedError` when this country is fully command.
 * Fails closed: any lookup failure blocks rather than permits.
 */
export async function assertPrivateEnterprisePermitted(db: Db, countryId: string): Promise<void> {
  if (await isPrivateEnterpriseBlocked(db, countryId)) {
    throw new PrivateEnterpriseBlockedError(countryId);
  }
}
