import {
  SWITCH_MARGIN,
  SWITCH_TURNS,
  DOMINANCE_FLOOR,
  GRACE_DECAY,
  type EconomicModelId,
} from "@/lib/constants/economicModels";

export interface ModelHysteresisState {
  current: EconomicModelId;
  challenger?: { modelId: EconomicModelId; turnsLeading: number };
}

/**
 * The §5.5 named-model transition with GRACE DECAY (not hard reset). Progress
 * toward a flip accrues only while a *non-incumbent* leader holds a ≥ SWITCH_MARGIN
 * lead; a brief sub-margin dip BLEEDS the counter by GRACE_DECAY rather than wiping
 * it (so a single oscillation near the threshold doesn't erase a year of progress).
 * A genuinely different leader starts a fresh counter; a sustained loss drains to 0
 * and clears the challenger; the leader flips once the counter reaches SWITCH_TURNS;
 * a leader below DOMINANCE_FLOOR collapses the identity to "mixed".
 */
export function transition(
  prev: ModelHysteresisState,
  leader: EconomicModelId,
  scores: Record<EconomicModelId, number>
): ModelHysteresisState {
  if (scores[leader] < DOMINANCE_FLOOR) {
    return { current: "mixed" }; // residual; challenger cleared
  }

  if (leader === prev.current) {
    // Incumbent back on top — decay any challenger, clear when it reaches 0.
    if (!prev.challenger) return { current: prev.current };
    const turnsLeading = Math.max(0, prev.challenger.turnsLeading - GRACE_DECAY);
    return turnsLeading > 0
      ? { current: prev.current, challenger: { modelId: prev.challenger.modelId, turnsLeading } }
      : { current: prev.current };
  }

  // Leader is a non-incumbent model.
  let challenger =
    !prev.challenger || prev.challenger.modelId !== leader
      ? { modelId: leader, turnsLeading: 0 } // new challenger identity → fresh counter
      : { ...prev.challenger };

  if (scores[leader] >= scores[prev.current] + SWITCH_MARGIN) {
    challenger = { ...challenger, turnsLeading: challenger.turnsLeading + 1 }; // durable lead → accrue
  } else {
    challenger = {
      ...challenger,
      turnsLeading: Math.max(0, challenger.turnsLeading - GRACE_DECAY),
    }; // dip → decay
  }

  if (challenger.turnsLeading >= SWITCH_TURNS) {
    return { current: leader }; // durable overtake → flip, clear challenger
  }
  if (challenger.turnsLeading === 0) {
    return { current: prev.current }; // fully decayed → drop challenger
  }
  return { current: prev.current, challenger };
}
