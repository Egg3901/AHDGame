import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getCabinetSettingsCollection } from "@/lib/db/collections/cabinetSettings";
import { aggregateForce, DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import {
  accrualPerTurn,
  upkeepPerTurn,
  overdraftFloor,
  settleAppropriation,
  type AppropriationSettlement,
} from "@/lib/military/appropriation";
import { seedRosterUpkeepFor } from "@/lib/military/seedRosterUpkeep";
import { resolveDefenseLineFrom } from "./defenseEnvelope";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  getDefenseAppropriation,
  applyAppropriationSettlementWithOverdraft,
} from "@/lib/db/collections/defenseAppropriation";
import { applyReadinessDrift } from "./militaryForceEffects";

export class DefenseAppropriationContentionError extends Error {
  readonly retryable = true;

  constructor(countryId: string, turn: number) {
    super(`Defense appropriation contention for ${countryId} at turn ${turn}; retry required`);
    this.name = "DefenseAppropriationContentionError";
  }
}

/**
 * Per-turn defence account sweep: accrue this turn's slice of the enacted defence line,
 * fund as much of the standing force's upkeep as the balance and overdraft allow, draw any
 * overdraft as national debt, and persist the arrears ratio that suppresses readiness.
 *
 * Runs for EVERY country with units, defence seat or not. That follows `applyReinforcement`,
 * which covers all nations because simulated ones must sustain their forces too, and
 * deliberately NOT `applyMilitaryForceEffects`, whose first act is to return early with no
 * seat: a country whose army is fed manpower every turn but never charged for it would be a
 * standing asymmetry between the two sweeps.
 *
 * Readiness drift runs from HERE for the same reason. It used to sit inside
 * `applyMilitaryForceEffects` and inherited that step's seat gate, so the eleven seatless
 * nations were charged upkeep and booked arrears that nothing ever collected on — an unfunded
 * French army held full readiness indefinitely. Drifting here also means the consumer reads
 * the ratio this step just computed, instead of depending on two turn steps staying adjacent.
 *
 * Returns null when there is nothing to do — no units, or this turn already accrued.
 */
export async function applyDefenseAppropriation(
  db: Db,
  countryId: string,
  turn: number,
  preset: string
): Promise<AppropriationSettlement | null> {
  const units = await getMilitaryUnitsCollection(db)
    .find({ countryId: countryId as CountryId })
    .toArray();
  if (units.length === 0) return null;

  // The force tier scales upkeep AND the readiness baseline the drift below walks toward.
  // Countries with no defence seat have no cabinet setting and fall back to "standard",
  // which is what their force actually runs at.
  const positionId = DEFENSE_POSITION_BY_COUNTRY[countryId as CountryId];
  const setting = positionId
    ? await getCabinetSettingsCollection(db).findOne({ _id: `${countryId}_${positionId}` })
    : null;
  const tier = setting?.tierSetting ?? "standard";

  const { totalUpkeep } = aggregateForce(units, countryId, tier);
  // Retry the complete read/calculation after a CAS miss. Reusing a settlement
  // computed from a stale appropriation balance would silently overwrite a
  // concurrent player debit in the accounting result.
  let settlement: AppropriationSettlement | null = null;
  let settled = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ countryId });
    if (!budget) return null;
    // An unmigrated budget must be seeded before settling. The seed is idempotent;
    // reload so the CAS includes the persisted pot value.
    if (!budget.defenseAppropriation) {
      await getDefenseAppropriation(db, countryId);
      continue;
    }
    const pot = budget.defenseAppropriation;
    if (pot.accruedThroughTurn >= turn) return null;
    const line = resolveDefenseLineFrom(budget);
    settlement = settleAppropriation(
      pot.balance,
      accrualPerTurn(line),
      upkeepPerTurn(totalUpkeep, seedRosterUpkeepFor(preset, countryId), line),
      overdraftFloor(line)
    );
    settled = await applyAppropriationSettlementWithOverdraft(
      db,
      countryId,
      turn,
      settlement,
      budget.treasuryBalance ?? 0,
      pot.balance,
      budget
    );
    if (settled) break;
  }
  if (!settlement) return null;
  if (!settled) throw new DefenseAppropriationContentionError(countryId, turn);
  // Only drift on the run that actually booked the turn. If the guarded write lost to a
  // concurrent turn pass, that pass has already drifted these units and doing it twice would
  // move readiness two steps in one turn.
  if (settled) await applyReadinessDrift(db, units, settlement.arrearsRatio, tier);
  return settlement;
}
