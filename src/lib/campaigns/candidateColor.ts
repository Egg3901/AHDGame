/**
 * Resolves a display color for a candidate — the candidate-set campaign color
 * if present, otherwise a deterministic distinct color per candidate within a
 * party so two same-party candidates don't collapse to one color on the map.
 */

import { getPartyHex } from "@/lib/utils/politics";

/**
 * Palette of visually distinct hues for intra-party primary candidates when no
 * Campaign.color has been set. Candidates are assigned in order of candidate
 * ObjectId (deterministic). The first two slots intentionally use blue/red so
 * projected presidential-primary maps blend into a more intuitive palette,
 * while later slots stay distinct for crowded primaries.
 */
const INTRA_PARTY_PALETTE = [
  "#3B82F6", // blue
  "#EF4444", // red
  "#8B5CF6", // violet
  "#06B6D4", // cyan
  "#F97316", // orange
  "#14B8A6", // teal
  "#EC4899", // pink
  "#A855F7", // purple
];

/**
 * Build a candidateId → color map for all candidates of a single party.
 * Campaign.color wins if set. In contested primaries we deliberately avoid
 * reusing the party's default color so same-party candidates remain visually
 * distinct on maps and legends. Single-candidate races still use the party color.
 *
 * `sortedCandidateIds` must be provided in stable order (usually the order the
 * candidates were inserted / sorted by _id).
 */
export function buildCandidateColorMap(
  candidates: Array<{ candidateId: string; campaignColor?: string | null }>,
  partyAbbreviationOrId: string,
  partyStoredColor: string | undefined
): Record<string, string> {
  const byId: Record<string, string> = {};
  const partyDefault = getPartyHex(partyAbbreviationOrId, partyStoredColor);

  // Stable ordering: sort by candidateId string so the palette assignment is
  // deterministic across renders.
  const sorted = [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const usePaletteOnly = sorted.length > 1;
  let paletteIdx = 0;
  for (const c of sorted) {
    if (c.campaignColor) {
      byId[c.candidateId] = c.campaignColor;
      continue;
    }
    if (!usePaletteOnly && paletteIdx === 0) {
      byId[c.candidateId] = partyDefault;
    } else {
      byId[c.candidateId] = INTRA_PARTY_PALETTE[paletteIdx % INTRA_PARTY_PALETTE.length];
    }
    paletteIdx += 1;
  }
  return byId;
}
