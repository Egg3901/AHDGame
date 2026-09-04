import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { stepCovertProgram } from "@/lib/military/covertNuclear";
import { applyCovertCrackdown } from "@/lib/military/covertCrackdown";
import {
  getCovertNuclearProgramsCollection,
  emptyCovertNuclearProgram,
  putCovertNuclearProgram,
} from "@/lib/db/collections/covertNuclearPrograms";
import {
  creditAppropriation,
  debitAppropriation,
  getDefenseAppropriation,
  uncommittedFrom,
} from "@/lib/db/collections/defenseAppropriation";

// Re-exported from its new home so existing importers keep working.
export { CRACKDOWN_APPROVAL_HIT } from "@/lib/military/covertCrackdown";

export interface CovertNuclearTurnResult {
  spent: number;
  discovered: boolean;
}

const NOTHING: CovertNuclearTurnResult = { spent: 0, discovered: false };

/**
 * Per-turn: the covert programme's quiet grind, run right after the overt
 * stockpile accrual in the same defence loop, for COVERT_CAPABLE countries only.
 *
 * Money follows the nuclearProductionTurn pattern: size the turn against the
 * UNCOMMITTED appropriation, take the cash through the guarded
 * `debitAppropriation` so a concurrent spend loses cleanly, and refund on a
 * failed programme write. Covert funding deliberately IGNORES
 * `defenceProcurementPaused`: the programme is off the books by design.
 *
 * A country that never opened the programme (no doc, no funding, no stages) is
 * skipped without a write, so the collection only carries countries that acted.
 *
 * Discovery is a Soviet crackdown: a world tension spike, a public wire story
 * that names undeclared facilities but never the programme's actual stage, and
 * the approval hit above. The public learns there was SOMETHING, not what.
 */
export async function applyCovertNuclearTurn(
  db: Db,
  countryId: CountryId,
  turn: number,
  gates: { coldWarEnabled?: boolean }
): Promise<CovertNuclearTurnResult> {
  if (gates.coldWarEnabled !== true) return NOTHING;

  // Never started: no doc, nothing funded, nothing built. Skip without a write
  // so the collection never grows a doc for a country that never opened it.
  const doc = await getCovertNuclearProgramsCollection(db).findOne({ _id: countryId });
  if (!doc) return NOTHING;
  const state = { ...emptyCovertNuclearProgram(countryId), ...doc };

  const pot = await getDefenseAppropriation(db, countryId);
  const available = Math.max(0, uncommittedFrom(pot));
  const roll = Math.random();
  let result = stepCovertProgram(state, available, roll);

  if (result.spent > 0) {
    // Guarded debit: a concurrent order between our read and this write makes
    // it return false, and the turn re-steps as an unfunded one instead of
    // minting progress the treasury never paid for.
    const paid = await debitAppropriation(db, countryId, result.spent);
    if (!paid) result = stepCovertProgram(state, 0, roll);
  }

  try {
    await putCovertNuclearProgram(db, {
      ...state,
      ...result.state,
      _id: countryId,
    });
  } catch (error) {
    // Refund a turn that never persisted - money must not vanish on a failed write.
    if (result.spent > 0) await creditAppropriation(db, countryId, result.spent);
    throw error;
  }

  if (result.discovered) {
    // Shared with the patron's intelligence service, which can reach the same
    // event by finding the programme and acting on it. See covertCrackdown.ts.
    await applyCovertCrackdown(db, countryId, turn);
  }

  return { spent: result.spent, discovered: result.discovered };
}
