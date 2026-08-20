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
  applyAppropriationSettlement,
} from "@/lib/db/collections/defenseAppropriation";
import { spendFromTreasury } from "@/lib/budget/treasurySpend";
import { applyReadinessDrift } from "./militaryForceEffects";

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

  // ONE read of the budget in the common case: the pot and the defence line both come out of
  // the same document.
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ countryId });
  // An unmigrated budget must be SEEDED before settling. The settlement is an atomic `$inc`
  // guarded on `accruedThroughTurn`, and neither would match a document with no pot — an
  // `$inc` would also create one holding just this turn's delta, losing the opening year of
  // accrual the heal is supposed to grant.
  const pot = budget?.defenseAppropriation ?? (await getDefenseAppropriation(db, countryId));
  // Cheap pre-check. The authoritative guard is the `$lt: turn` filter on the write itself,
  // which is what actually stops two overlapping turn runs double-crediting.
  if (pot.accruedThroughTurn >= turn) return null;

  // The force tier scales upkeep AND the readiness baseline the drift below walks toward.
  // Countries with no defence seat have no cabinet setting and fall back to "standard",
  // which is what their force actually runs at.
  const positionId = DEFENSE_POSITION_BY_COUNTRY[countryId as CountryId];
  const setting = positionId
    ? await getCabinetSettingsCollection(db).findOne({ _id: `${countryId}_${positionId}` })
    : null;
  const tier = setting?.tierSetting ?? "standard";

  const line = resolveDefenseLineFrom(budget);
  const { totalUpkeep } = aggregateForce(units, countryId, tier);
  const upkeep = upkeepPerTurn(totalUpkeep, seedRosterUpkeepFor(preset, countryId), line);

  const settlement = settleAppropriation(
    pot.balance,
    accrualPerTurn(line),
    upkeep,
    overdraftFloor(line)
  );

  // The overdraft is spending BEYOND the enacted line, which no budget row accounted for —
  // so unlike the accrual (money `processTreasuryTurn` has already deducted) it genuinely
  // does hit the treasury, as ordinary national debt.
  if (settlement.overdraftDrawn > 0) {
    await spendFromTreasury(db, countryId, settlement.overdraftDrawn);
  }
  const settled = await applyAppropriationSettlement(db, countryId, turn, settlement);
  // Only drift on the run that actually booked the turn. If the guarded write lost to a
  // concurrent turn pass, that pass has already drifted these units and doing it twice would
  // move readiness two steps in one turn.
  if (settled) await applyReadinessDrift(db, units, settlement.arrearsRatio, tier);
  return settlement;
}
