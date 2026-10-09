/**
 * Influence previews estimate one play's effective share gain in isolation.
 * previewEffectivePlay applies channel strength, strain and the existing drift
 * rules; other plays and background effects are not forecast. A rival's standing push, when
 * given, is netted against the play exactly as the turn phase nets it.
 */
import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";
import { computeDrift, NON_ALIGNED_RESISTANCE } from "../drift";
import { roundToShareGrid, type AlignmentShares } from "../normalize";

/** Estimate this play alone, with no other plays or background movement. */
export function previewEffectivePlay(input: {
  shares: AlignmentShares;
  poles: readonly AlignmentPoleId[];
  poleId: AlignmentPoleId;
  amountLocal: number;
  /** Existing quote includes resistance, but not channel weight or bloc strain. */
  pointCostLocal: number;
  playMaxPoints: number;
  resistsAtHalfStrength: boolean;
  weight: number;
  effectiveness: number;
  turnCap: number;
  /** A rival's standing push on the target; opposing pulls cancel before the cap. */
  rivalPressure?: { poleId: AlignmentPoleId; points: number } | null;
}): number {
  if (
    ![
      input.amountLocal,
      input.pointCostLocal,
      input.playMaxPoints,
      input.weight,
      input.effectiveness,
      input.turnCap,
    ].every((value) => Number.isFinite(value) && value > 0) ||
    !input.poles.includes(input.poleId)
  )
    return 0;
  const points = Math.min(input.amountLocal / input.pointCostLocal, input.playMaxPoints);
  const resistance = input.resistsAtHalfStrength ? NON_ALIGNED_RESISTANCE : 1;
  const rival = input.rivalPressure;
  const rivalPull =
    rival && rival.poleId !== input.poleId && rival.points > 0 && input.poles.includes(rival.poleId)
      ? { [rival.poleId]: rival.points }
      : {};
  const after = computeDrift({
    shares: input.shares,
    poles: input.poles,
    pull: {
      ...rivalPull,
      [input.poleId]: (points / resistance) * input.weight * input.effectiveness,
    },
    cap: input.turnCap,
  });
  return Math.max(
    0,
    roundToShareGrid((after.shares[input.poleId] ?? 0) - (input.shares.shares[input.poleId] ?? 0))
  );
}
