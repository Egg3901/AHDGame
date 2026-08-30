import type { Db, ObjectId } from "mongodb";
import type { AxisPositions, Character, PolicyShiftLedgerEntry } from "@/lib/db/types";
import { snapToPositionGrid } from "@/lib/utils/politics";

export type { AxisPositions, PolicyShiftLedgerEntry };

/** Where a bill sits on each axis; an axis nobody takes a stance on is absent. */
export interface AxisTargets {
  economic?: number;
  social?: number;
}

export type BillVote = "for" | "against" | "abstain";

/** Maximum net movement per axis a single bill may cause. */
export const VOTE_SHIFT_STEP = 0.25;
const POSITION_MIN = -5;
const POSITION_MAX = 5;
const AXES = ["economic", "social"] as const;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Snap to the 0.05 grid and strip float noise (grid values are exact at 2 dp). */
function onGrid(value: number): number {
  return Number(snapToPositionGrid(value).toFixed(2));
}

/**
 * The bill's position on each axis: the average of every provision that takes a
 * stance there. Omitted and 0 values are "no stance" (ticket #1116) and are left
 * out of the average rather than pulling it toward centre. Callers pass only the
 * provisions that carry ideology (policy provisions), never tariffs, subsidies,
 * war declarations and the like.
 */
export function billPositionTargets(
  provisions: ReadonlyArray<{ economic?: number; social?: number }>
): AxisTargets {
  const targets: AxisTargets = {};
  for (const axis of AXES) {
    const stances = provisions
      .map((p) => p[axis])
      .filter((v): v is number => typeof v === "number" && v !== 0);
    if (stances.length > 0) {
      targets[axis] = stances.reduce((sum, v) => sum + v, 0) / stances.length;
    }
  }
  return targets;
}

/**
 * Net movement from `baseline` that a vote should produce.
 *
 * - Aye: toward the bill, by at most one step and never past the bill's position.
 * - Nay: away from the bill by one step.
 * - Abstain, an axis with no target, or a voter already on the bill's position: 0.
 *
 * The resulting position is clamped to the -5..+5 range and snapped to the grid.
 */
export function computeVoteShift(
  baseline: AxisPositions,
  targets: AxisTargets,
  vote: BillVote
): AxisPositions {
  const delta: AxisPositions = { economic: 0, social: 0 };
  if (vote === "abstain") return delta;
  for (const axis of AXES) {
    const target = targets[axis];
    if (target === undefined) continue;
    const distance = target - baseline[axis];
    if (distance === 0) continue;
    const magnitude =
      vote === "for" ? Math.min(VOTE_SHIFT_STEP, Math.abs(distance)) : VOTE_SHIFT_STEP;
    const direction = vote === "for" ? Math.sign(distance) : -Math.sign(distance);
    const landing = onGrid(
      clamp(baseline[axis] + direction * magnitude, POSITION_MIN, POSITION_MAX)
    );
    delta[axis] = Number((landing - baseline[axis]).toFixed(2));
  }
  return delta;
}

export interface VoteShiftPreview {
  /** Where the voter stands now. */
  current: AxisPositions;
  /** Movement from `current` if they vote Aye. */
  aye: AxisPositions;
  /** Movement from `current` if they vote Nay. */
  nay: AxisPositions;
}

/**
 * What each button would do from where the voter stands now. Once a shift has
 * been applied for this bill the move can exceed one step (Aye then Nay is a
 * half-point swing) while the net from the baseline stays within one step.
 */
export function previewVoteShift(
  current: AxisPositions,
  targets: AxisTargets,
  ledgerEntry: PolicyShiftLedgerEntry | undefined
): VoteShiftPreview {
  const baseline = ledgerEntry?.baseline ?? current;
  const applied = ledgerEntry?.applied ?? { economic: 0, social: 0 };
  const fromCurrent = (vote: BillVote): AxisPositions => {
    const next = computeVoteShift(baseline, targets, vote);
    return {
      economic: Number((next.economic - applied.economic).toFixed(2)),
      social: Number((next.social - applied.social).toFixed(2)),
    };
  };
  return { current, aye: fromCurrent("for"), nay: fromCurrent("against") };
}

/**
 * Whether a vote should touch the voter's positions. A vote recorded before the
 * ledger existed has no entry saying what it moved, so changing it cannot be
 * measured against a baseline and is left alone rather than granting a free step.
 */
export function shouldApplyVoteShift(
  previousVote: BillVote | undefined,
  ledgerEntry: PolicyShiftLedgerEntry | undefined
): boolean {
  if (ledgerEntry) return true;
  return !previousVote || previousVote === "abstain";
}

/**
 * The vote the member cast THEMSELVES, seen through any party whip that later
 * overwrote it. A whip's choice is not the member's stance: it never moved
 * their positions, so it must not count as a prior vote either. The whip
 * snapshot holds the pre-whip value ("unvoted" when there was none).
 */
export function personalPreviousVote(
  recordedVote: BillVote | undefined,
  whippedFrom: string | undefined
): BillVote | undefined {
  if (whippedFrom === undefined) return recordedVote;
  if (whippedFrom === "for" || whippedFrom === "against" || whippedFrom === "abstain") {
    return whippedFrom;
  }
  return undefined;
}

export interface ApplyBillVotePolicyShiftInput {
  collection: "bills" | "stateBills";
  billId: ObjectId;
  characterId: ObjectId;
  provisions: ReadonlyArray<{ economic?: number; social?: number }>;
  vote: BillVote;
  currentPolicies: AxisPositions;
  ledgerEntry: PolicyShiftLedgerEntry | undefined;
}

/**
 * Applies a bill vote to a character's positions and records the movement on
 * the bill's ledger.
 *
 * The delta is always computed from the ledger baseline (the position held
 * before this bill first moved the voter) and only the DIFFERENCE from what was
 * previously applied is added to the current position, so shifts from other
 * bills in between are preserved and the net from this bill never exceeds one
 * step. Abstaining after an Aye or Nay reverts what that vote applied.
 */
export async function applyBillVotePolicyShift(
  db: Db,
  {
    collection,
    billId,
    characterId,
    provisions,
    vote,
    currentPolicies,
    ledgerEntry,
  }: ApplyBillVotePolicyShiftInput
): Promise<void> {
  // The caller read the bill before recording the vote; a vote that landed in
  // between may already have written an entry. Re-read at write time so two
  // rapid votes cannot both start from "no entry" and each apply a full step.
  const key = `policyShiftLedger.${characterId.toString()}`;
  const fresh = await db
    .collection<{ policyShiftLedger?: Record<string, PolicyShiftLedgerEntry> }>(collection)
    .findOne({ _id: billId }, { projection: { [key]: 1 } });
  const entry = fresh ? fresh.policyShiftLedger?.[characterId.toString()] : ledgerEntry;

  if (vote === "abstain" && !entry) return;

  const baseline = entry?.baseline ?? { ...currentPolicies };
  const applied = entry?.applied ?? { economic: 0, social: 0 };
  const next = computeVoteShift(baseline, billPositionTargets(provisions), vote);
  const changeEconomic = Number((next.economic - applied.economic).toFixed(2));
  const changeSocial = Number((next.social - applied.social).toFixed(2));

  if (changeEconomic === 0 && changeSocial === 0 && entry) return;

  if (changeEconomic !== 0 || changeSocial !== 0) {
    await db.collection<Character>("characters").updateOne(
      { _id: characterId },
      {
        $set: {
          "policies.economic": onGrid(
            clamp(currentPolicies.economic + changeEconomic, POSITION_MIN, POSITION_MAX)
          ),
          "policies.social": onGrid(
            clamp(currentPolicies.social + changeSocial, POSITION_MIN, POSITION_MAX)
          ),
          updatedAt: new Date(),
        },
      }
    );
  }

  const nextEntry: PolicyShiftLedgerEntry = { baseline, applied: next };
  await db.collection(collection).updateOne({ _id: billId }, { $set: { [key]: nextEntry } });
}
