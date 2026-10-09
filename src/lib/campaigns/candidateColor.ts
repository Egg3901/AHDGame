/**
 * Resolves a display color for a candidate — the candidate-set campaign color
 * if present, otherwise a deterministic distinct color per candidate within a
 * party so two same-party candidates don't collapse to one color on the map.
 */

import { getPartyHex } from "@/lib/utils/politics";

/**
 * Palette for intra-party primary candidates without a usable campaign colour.
 * Assigned in order of candidate id (deterministic). Mid-saturation hues spaced
 * around the wheel and kept clear of the stock party blue and red, so a primary
 * map reads as candidates, not as parties, and a crowded field stays readable
 * without neon.
 */
const INTRA_PARTY_PALETTE = [
  "#4F8EF7", // soft blue
  "#F2A93B", // amber
  "#2BB3A3", // teal
  "#B57BEE", // lavender
  "#E8677A", // rose
  "#7CC26B", // green
  "#F08A4B", // orange
  "#5BC0EB", // sky
];

/**
 * Two colours closer than this (RGB distance) read as the same candidate on a
 * map. A campaign colour that close to one already in use gives way to the
 * palette.
 */
export const MIN_CANDIDATE_COLOR_DISTANCE = 90;

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** RGB distance between two hex colours; Infinity when either is not hex. */
export function colorDistance(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return Infinity;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

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
  const used: string[] = [];
  const clash = (color: string) =>
    usePaletteOnly && used.some((u) => colorDistance(u, color) < MIN_CANDIDATE_COLOR_DISTANCE);
  let paletteIdx = 0;
  const nextPalette = (): string => {
    // Skip palette slots that clash with a campaign colour already placed.
    for (let tries = 0; tries < INTRA_PARTY_PALETTE.length; tries++) {
      const color = INTRA_PARTY_PALETTE[paletteIdx % INTRA_PARTY_PALETTE.length];
      paletteIdx += 1;
      if (!clash(color)) return color;
    }
    return INTRA_PARTY_PALETTE[paletteIdx++ % INTRA_PARTY_PALETTE.length];
  };
  // Campaign colours first, so a player's chosen colour is kept unless it
  // duplicates another player's; then everyone else from the palette.
  for (const c of sorted) {
    if (c.campaignColor && !clash(c.campaignColor)) {
      byId[c.candidateId] = c.campaignColor;
      used.push(c.campaignColor);
    }
  }
  for (const c of sorted) {
    if (byId[c.candidateId]) continue;
    const color = !usePaletteOnly ? partyDefault : nextPalette();
    byId[c.candidateId] = color;
    used.push(color);
  }
  return byId;
}
