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
import { COMMAND_CEILING, scheduledMarketizationLevel } from "@/lib/constants/commandEconomy";
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

/** Dual-track and above permits private enterprise; fully command does not. */
export function isPrivateEnterprisePermittedAtLevel(level: number): boolean {
  return level >= COMMAND_CEILING;
}

/**
 * Pure, schedule-only answer. Safe in a client component: no DB, no driver.
 *
 * Ignores any persisted drift, so it can disagree with the live value near the
 * threshold. Use it for UI affordances only, never as the write-path authority -
 * server paths take `loadPrivateEnterpriseBlockedCountries`.
 */
export function privateEnterpriseBlockedByYear(
  countryId: string | null | undefined,
  currentYear: number | null | undefined
): boolean {
  return !isPrivateEnterprisePermittedAtLevel(scheduledMarketizationLevel(countryId, currentYear));
}

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
 * Throws `PrivateEnterpriseBlockedError` when this country is fully command.
 * Fails closed: any lookup failure blocks rather than permits.
 */
export async function assertPrivateEnterprisePermitted(db: Db, countryId: string): Promise<void> {
  let blocked: Set<CountryId>;
  try {
    blocked = await loadPrivateEnterpriseBlockedCountries(db);
  } catch {
    throw new PrivateEnterpriseBlockedError(countryId);
  }
  if (blocked.has(countryId as CountryId)) {
    throw new PrivateEnterpriseBlockedError(countryId);
  }
}
