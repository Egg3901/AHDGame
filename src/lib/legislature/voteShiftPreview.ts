import type { AxisPositions, PolicyShiftLedgerEntry } from "@/lib/db/types";
import {
  billPositionTargets,
  previewVoteShift,
  shouldApplyVoteShift,
  type BillVote,
  type VoteShiftPreview,
} from "@/lib/policyShift";

export type { VoteShiftPreview };

export interface BuildVoteShiftPreviewInput {
  /** Policy provisions only; callers strip tariffs, subsidies and the like first. */
  provisions: ReadonlyArray<{ economic?: number; social?: number }>;
  ledger: Record<string, PolicyShiftLedgerEntry> | undefined;
  characterId: string | null;
  policies: AxisPositions | undefined;
  previousVote: BillVote | undefined;
  canVote: boolean;
}

/**
 * What the viewer's Aye and Nay would each do to their positions, computed
 * server-side by the same functions the vote command applies, so the preview
 * can never disagree with the write. Null for spectators.
 */
export function buildVoteShiftPreview({
  provisions,
  ledger,
  characterId,
  policies,
  previousVote,
  canVote,
}: BuildVoteShiftPreviewInput): VoteShiftPreview | null {
  if (!canVote || !characterId || !policies) return null;
  const current: AxisPositions = { economic: policies.economic, social: policies.social };
  const entry = ledger?.[characterId];
  if (!shouldApplyVoteShift(previousVote, entry)) {
    const none: AxisPositions = { economic: 0, social: 0 };
    return { current, aye: none, nay: { ...none } };
  }
  return previewVoteShift(current, billPositionTargets(provisions), entry);
}
