import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CabinetSetting } from "@/lib/db/types/cabinetSetting";
import type { CountryId } from "@/lib/constants/countries";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { aggregateForce } from "@/lib/constants/military";
import { accrualPerTurn, upkeepPerTurn } from "@/lib/military/appropriation";
import { resolveSeedRosterUpkeep } from "@/lib/military/seedRosterUpkeepPin";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getCabinetSettingsCollection } from "@/lib/db/collections/cabinetSettings";

/**
 * Where the standing force's money comes from, per turn, in local currency.
 *
 * The surplus tile counts the enacted defence LINE, but the force costs what
 * it costs: upkeep beyond the line is drawn from the treasury as national
 * debt (`applyDefenseAppropriation`) without touching any spending row. That
 * is why a treasury balance can fall while a surplus shows. This read-only
 * position puts both sides on the budget page so the two reconcile on screen.
 * It changes no accounting: the turn phase remains the sole writer.
 */
export interface DefenseFundingPosition {
  /** Enacted defence line for the year (the figure the surplus tile counts). */
  lineAnnual: number;
  /** This turn's slice of the line, credited to the appropriation pot. */
  accrualPerTurn: number;
  /** This turn's force upkeep, debited from the pot. */
  upkeepPerTurn: number;
  /** Upkeep beyond funding (`max(0, upkeep - accrual)`): the per-turn treasury bleed. */
  shortfallPerTurn: number;
  /** Appropriation pot balance; negative = cumulative overdraft already drawn. */
  potBalance: number | null;
  /** Share of upkeep going unpaid (0 = fully funded, via overdraft if needed). */
  arrearsRatio: number;
  /** Standing units counted. */
  unitCount: number;
}

/**
 * Read-only defence funding position for the budget page (live budgets only).
 * Returns null when the country fields no force. `preset` selects the seed
 * roster the upkeep ratio is measured against (same input the turn uses).
 */
export async function loadDefenseFunding(
  db: Db,
  countryId: CountryId,
  budget: Pick<
    FederalBudget,
    "spending" | "baselineSpendingByCategory" | "gdp" | "defenseAppropriation"
  >,
  preset: string
): Promise<DefenseFundingPosition | null> {
  const units = await getMilitaryUnitsCollection(db).find({ countryId }).toArray();
  if (units.length === 0) return null;

  const positionId = DEFENSE_POSITION_BY_COUNTRY[countryId];
  const setting = positionId
    ? await getCabinetSettingsCollection(db).findOne({ _id: `${countryId}_${positionId}` })
    : null;
  const tier = (setting as CabinetSetting | null)?.tierSetting ?? "standard";

  const lineAnnual = resolveDefenseLineFrom(budget);
  const { totalUpkeep } = aggregateForce(units, countryId, tier);
  const accrual = accrualPerTurn(lineAnnual);
  const upkeep = upkeepPerTurn(
    totalUpkeep,
    await resolveSeedRosterUpkeep(db, preset, countryId),
    lineAnnual
  );

  return {
    lineAnnual,
    accrualPerTurn: accrual,
    upkeepPerTurn: upkeep,
    shortfallPerTurn: Math.max(0, upkeep - accrual),
    potBalance: budget.defenseAppropriation?.balance ?? null,
    arrearsRatio: budget.defenseAppropriation?.arrearsRatio ?? 0,
    unitCount: units.length,
  };
}
