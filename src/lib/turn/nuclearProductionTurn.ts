import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { accrueWarheads, productionCapFor } from "@/lib/military/nuclearProgram";
import { getNuclearProgram, putNuclearProgram } from "@/lib/db/collections/nuclearPrograms";
import {
  creditAppropriation,
  debitAppropriation,
  getDefenseAppropriation,
  uncommittedFrom,
} from "@/lib/db/collections/defenseAppropriation";

export interface NuclearProductionResult {
  warheadsBuilt: number;
  spent: number;
}

const NOTHING: NuclearProductionResult = { warheadsBuilt: 0, spent: 0 };

/**
 * Per-turn: build the warheads the defence seat has ordered, paid for out of
 * the same defence appropriation the recruit/refit/contract flows spend from.
 *
 * The order of operations is the money-conservation pattern the routes use:
 * size the build against the UNCOMMITTED balance (never money a live contract
 * has already reserved), take the cash through the guarded `debitAppropriation`
 * so a concurrent spend loses cleanly instead of overdrawing, and only then
 * credit the stockpile. A failed programme write refunds the debit - warheads a
 * nation paid for must exist, and money warheads never consumed must return.
 *
 * `accrueWarheads` already clamps the ordered rate to the adopted device tier's
 * cap and to what the balance affords, so a starved budget builds fewer (or
 * zero) warheads rather than going into arrears; there is no overdraft for new
 * production, same as procurement.
 *
 * Skips while `defenceProcurementPaused` - the stockpile is procurement by
 * another name and the kill switch must cover it - and while the Cold War
 * subsystem is off. The `_year` slot is reserved for era-priced production.
 */
export async function applyNuclearProduction(
  db: Db,
  countryId: CountryId,
  _year: number,
  _turn: number,
  preloadedGameState?: { coldWarEnabled?: boolean; defenceProcurementPaused?: boolean }
): Promise<NuclearProductionResult> {
  const gs =
    preloadedGameState ??
    (await db
      .collection<{ _id: string; coldWarEnabled?: boolean; defenceProcurementPaused?: boolean }>(
        "gameState"
      )
      .findOne(
        { _id: "current" },
        { projection: { coldWarEnabled: 1, defenceProcurementPaused: 1 } }
      )) ??
    {};
  if (gs.coldWarEnabled !== true) return NOTHING;
  if (gs.defenceProcurementPaused === true) return NOTHING;

  const program = await getNuclearProgram(db, countryId);
  if (program.productionRate <= 0) return NOTHING;
  if (productionCapFor(program.adopted) <= 0) return NOTHING;

  const pot = await getDefenseAppropriation(db, countryId);
  const available = Math.max(0, uncommittedFrom(pot));
  const { built, cost } = accrueWarheads(program.adopted, program.productionRate, available);
  if (built <= 0) return NOTHING;

  // Guarded debit: a concurrent order between our read and this write makes it
  // return false, and we build nothing rather than mint unpaid-for warheads.
  const paid = await debitAppropriation(db, countryId, cost);
  if (!paid) return NOTHING;

  try {
    await putNuclearProgram(db, { ...program, warheads: program.warheads + built });
  } catch (error) {
    await creditAppropriation(db, countryId, cost);
    throw error;
  }
  return { warheadsBuilt: built, spent: cost };
}
