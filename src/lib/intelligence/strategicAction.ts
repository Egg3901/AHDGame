import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  getCovertNuclearProgram,
  putCovertNuclearProgram,
} from "@/lib/db/collections/covertNuclearPrograms";
import type { CovertProgramState } from "@/lib/military/covertNuclear";
import { COVERT_CAPABLE } from "@/lib/military/covertNuclear";
import { applyCovertCrackdown } from "@/lib/military/covertCrackdown";

/**
 * Who answers for a covert programme when it is found.
 *
 * A patron is the power the programme is being hidden FROM: East Germany is
 * building under Moscow's nose, so Moscow is the one whose discovery becomes a
 * public crackdown rather than a quiet act of sabotage. Kept as a small explicit
 * map, the way `COVERT_CAPABLE` is, because it is a handful of authored facts
 * and not something to derive from bloc membership.
 */
export const COVERT_PATRON: Partial<Record<CountryId, CountryId>> = {
  DD: "RU",
};

/**
 * A covert programme knocked back by sabotage.
 *
 * Pure. Loses the stage in progress and one completed stage, the same ground a
 * crackdown costs. Deliberately does NOT touch funding or suspicion: a
 * crackdown is the government being caught and reacting, while sabotage is
 * something breaking for reasons the programme cannot see. Stages slip and
 * nobody in Berlin knows why.
 */
export function sabotagedCovertState(state: CovertProgramState): CovertProgramState {
  return {
    ...state,
    stage: Math.max(0, state.stage - 1),
    progress: 0,
    // A device already banked cannot be un-built by breaking a facility.
    completed: state.completed,
  };
}

/** Whether a covert programme is running at all. Nothing to sabotage otherwise. */
export function isCovertProgrammeActive(state: CovertProgramState): boolean {
  return state.stage > 0 || state.funding !== "none";
}

export interface StrategicActionResult {
  sabotaged: boolean;
  crackdown: boolean;
}

/**
 * The effect half of a successful strategic covert action.
 *
 * Two outcomes, and which one you get depends on who you are:
 *
 * - Anyone knocks the programme back a stage. Quiet: the target loses ground
 *   without being told why.
 * - The PATRON additionally triggers the public crackdown, because Moscow
 *   finding the programme is not sabotage, it is an inspection with a rebuke
 *   attached. This is the "foreign discovery supplements the self-roll" path
 *   the design settled on: the programme's own carelessness is one route to a
 *   crackdown, a patron acting on what its service found is the other.
 *
 * Reaching here at all required exact-tier coverage through the action gate, so
 * the patron has genuinely FOUND the programme rather than guessed at it.
 */
export async function applyStrategicAction(
  db: Db,
  ownerCountryId: CountryId,
  targetCountryId: CountryId,
  turn: number
): Promise<StrategicActionResult> {
  if (!COVERT_CAPABLE.includes(targetCountryId)) return { sabotaged: false, crackdown: false };

  const program = await getCovertNuclearProgram(db, targetCountryId);
  if (!isCovertProgrammeActive(program)) return { sabotaged: false, crackdown: false };

  const sabotaged = sabotagedCovertState(program);
  await putCovertNuclearProgram(db, { ...program, ...sabotaged });

  const isPatron = COVERT_PATRON[targetCountryId] === ownerCountryId;
  if (isPatron) await applyCovertCrackdown(db, targetCountryId, turn);

  return { sabotaged: true, crackdown: isPatron };
}
