import type { GlobalResponseOutcome } from "@/lib/db/types/crisis";
import type { LivingConflictState } from "../types";

/** National relief and assistance still take effect when escalation wins the headline. */
export function russiaUkraineOutcome(
  state: LivingConflictState,
  selected: GlobalResponseOutcome,
  outcomes: readonly GlobalResponseOutcome[],
  scores: Readonly<Record<string, number>>
): GlobalResponseOutcome {
  const base =
    selected.outcomeId === "broad_invasion" && state.phaseLevel < 4
      ? (outcomes.find((outcome) => outcome.outcomeId === "limited_incursion") ?? selected)
      : selected;
  const finite = (axis: string, cap: number) =>
    Number.isFinite(scores[axis]) ? Math.max(0, Math.min(cap, scores[axis])) : 0;
  const relief = finite("aid", 12);
  const militaryAid = finite("militaryAid", 12);
  const sanctions = finite("sanctions", 12);
  const tracks = { ...base.trackDeltas };
  for (const [key, delta] of Object.entries({
    displacement: -relief / 2,
    reconstruction: state.phaseLevel === 6 ? relief : 0,
    westernAid: militaryAid,
    sanctionsPressure: sanctions,
  }))
    tracks[key] = (tracks[key] ?? 0) + delta;
  return {
    ...base,
    // Military posture alone must never make inferred campaign stages produce
    // combat deaths. These stages follow the actually resolved security choice.
    nextCampaignStage: ["proxy_conflict", "limited_incursion", "broad_invasion"].includes(
      base.outcomeId
    )
      ? "operations"
      : base.outcomeId === "negotiated_neutrality" || base.outcomeId === "deterrence_holds"
        ? state.phaseLevel === 6
          ? "aftermath"
          : "settlement"
        : state.phaseLevel === 3 || state.phaseLevel === 5
          ? "operations"
          : "posture",
    trackDeltas: tracks,
    campaignDelta: {
      ...base.campaignDelta,
      civilianStrain: (base.campaignDelta?.civilianStrain ?? 0) - relief / 2,
    },
  };
}
