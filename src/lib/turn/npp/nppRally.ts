/**
 * NPP engine 6.2: an NPP candidate's campaign action rallies its own race (v6).
 *
 * Below v6 an NPP's campaign action raises its general political influence and
 * nothing reaches the race it is running in: NPPs have no campaign document,
 * so the rally that moves a player candidate's Support never fires for them,
 * and their Support sits at the neutral 50.
 *
 * At v6 the first campaign action of a cycle by an NPP that is an active
 * candidate in a rally-eligible race becomes a rally for that race instead. It
 * costs the action points and funds the campaign action already costs, gives
 * up that action's influence gain, and moves Support by exactly what a player
 * rally in the same race family moves it (same value, same 60/40 split, same
 * drip). Players may rally once a turn; an NPP rallies at most once per
 * action cycle, which is once every four turns.
 */
import type { ObjectId } from "mongodb";
import { getCampaignFamilyScalar } from "@/lib/campaigns/upgradeCosts";
import { SUPPORT_RALLY_FULL_VALUE } from "@/lib/electionEngine/electionFormulaFactors";
import { buildRallyAccrualEntry } from "@/lib/turn/elections/supportAccrual";
import type { NppRaceSignal } from "@/lib/npp/actionSignals";

export interface NppRallyWrite {
  updateOne: {
    filter: { _id: ObjectId; status: "active" };
    update: {
      $set: { support: number; lastRallyTurn: number };
      $push: { supportAccrual: { amountPerTurn: number; turnsRemaining: number } };
    };
  };
}

/** The candidate-row write for a rally, or null when this NPP cannot rally now. */
export function planNppRally(
  race: NppRaceSignal | null | undefined,
  currentTurn: number
): NppRallyWrite | null {
  if (!race?.rallyEligible) return null;
  if (race.lastRallyTurn != null && race.lastRallyTurn >= currentTurn) return null;
  const scaledR = SUPPORT_RALLY_FULL_VALUE * getCampaignFamilyScalar(race.electionType);
  const { immediateBump, entry } = buildRallyAccrualEntry(scaledR);
  if (immediateBump <= 0) return null;
  return {
    updateOne: {
      filter: { _id: race.candidateRowId, status: "active" },
      update: {
        $set: {
          support: Math.max(0, Math.min(100, race.support + immediateBump)),
          lastRallyTurn: currentTurn,
        },
        $push: { supportAccrual: entry },
      },
    },
  };
}
