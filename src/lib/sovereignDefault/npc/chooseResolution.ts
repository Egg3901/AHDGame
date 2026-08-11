/**
 * NPC chooseResolution — design Section 6.2.
 *
 * Filters availability gates (monetize blocked when inflation > 8%), scores
 * each remaining option, sorts by descending score with deterministic
 * tie-break (bailout > restructure > monetize > repudiate), returns winner.
 *
 * Pure function. Deterministic. No DB.
 */

import type { SovereignResolutionChoice } from "@/lib/db/types/budget";
import type { NpcCountryState, NpcExecutiveProfile } from "./types";
import { scoreNpcOption } from "./scoreNpcOption";
import { tieBreakOrder } from "./tieBreakOrder";

const ALL_OPTIONS: SovereignResolutionChoice[] = [
  "bailout",
  "restructure",
  "monetize",
  "repudiate",
];

export function chooseResolution(
  state: NpcCountryState,
  leader: NpcExecutiveProfile
): SovereignResolutionChoice {
  const available = ALL_OPTIONS.filter((opt) => {
    if (opt === "monetize" && state.inflationGateExceeded) return false;
    return true;
  });
  if (available.length === 0) return "bailout"; // safety net per Section 6.7
  const scored = available
    .map((opt) => ({ option: opt, score: scoreNpcOption(opt, state, leader) }))
    .sort((a, b) => b.score - a.score || tieBreakOrder(a.option, b.option));
  return scored[0].option;
}
