/**
 * Party mergers enforce the active-player NPP cap after regional selection.
 * Existing NPPs of the surviving party are always retained, even above the cap.
 * Incoming NPPs fill only remaining slots, ranked by influence, favorability, id.
 */
export interface MergeNppRank {
  id: string;
  politicalInfluence: number;
  favorability: number;
}

export function selectNationalMergeNppCull({
  survivingNpps,
  incomingNpps,
  maxNpps,
}: {
  survivingNpps: readonly Pick<MergeNppRank, "id">[];
  /** Only incoming NPPs that passed the regional recruitment cap. */
  incomingNpps: readonly MergeNppRank[];
  maxNpps: number;
}): string[] {
  if (!Number.isSafeInteger(maxNpps) || maxNpps < 0) {
    throw new Error("Invalid post-merger NPP capacity");
  }
  const remaining = Math.max(0, maxNpps - survivingNpps.length);
  return [...incomingNpps]
    .sort(compareStrength)
    .slice(remaining)
    .map((npp) => npp.id);
}

function compareStrength(a: MergeNppRank, b: MergeNppRank): number {
  const influence =
    (Number.isFinite(b.politicalInfluence) ? b.politicalInfluence : 0) -
    (Number.isFinite(a.politicalInfluence) ? a.politicalInfluence : 0);
  if (influence !== 0) return influence;
  const favorability =
    (Number.isFinite(b.favorability) ? b.favorability : 0) -
    (Number.isFinite(a.favorability) ? a.favorability : 0);
  if (favorability !== 0) return favorability;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
