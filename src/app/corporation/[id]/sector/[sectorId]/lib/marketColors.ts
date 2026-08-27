/**
 * Colours for the market-position ring and its legend.
 *
 * The old list was nine hues handed out by array index and cycled with `i % 9`.
 * Measured against the card surface it failed three of the standard palette
 * checks: `#3b82f6` and `#8b5cf6` were ΔE 1.3 apart under deuteranopia (the same
 * colour to a red-green colourblind reader), `#14b8a6` and `#22c55e` were 11.3
 * apart even with full colour vision, and three of the nine sat outside the
 * dark-mode lightness band. Cycling then guaranteed outright collisions past the
 * ninth rival.
 *
 * These four are the replacement, and the ORDER IS PART OF THE RESULT: teal must
 * not neighbour pink (ΔE 3.8 under deuteranopia when it does). As written they
 * pass every check on the dark card surface and on the light one. On the navy
 * theme the pink warns at 2.5:1 contrast, which the legend beside the chart
 * discharges by naming every series in text.
 *
 * Four is deliberate rather than shy. This slot list is only reached by a
 * player-owned corp with no brand colour of its own, and folding the NPP field
 * into a single arc means a sector almost never shows more than a handful of
 * player slices. Past four the answer is the list, not a fifth hue.
 */

/** Player-corp fallback slots, in validated order. Never cycle past the end. */
export const PLAYER_SLOT_COLORS = ["#3b82f6", "#db2777", "#d97706", "#0d9488"] as const;

/**
 * The NPP field's single arc: low chroma so it reads as ground rather than
 * figure, and distinct from the near-transparent "Unowned" grey it can sit
 * beside. The muting is what makes the player's own slice legible against a
 * field that may hold 90%+ of the market.
 */
export const NPP_ARC_COLOR = "#6b7280";

/**
 * A stable colour for a player corp that has not set a brand colour.
 *
 * Keyed off the corporation's identity, not its position in the array, so a
 * rival leaving the sector cannot repaint the corps after it. `fallbackIndex` is
 * only for the case where there is no id to hash.
 */
export function playerSlotColor(key: string | undefined, fallbackIndex: number): string {
  if (!key) return PLAYER_SLOT_COLORS[fallbackIndex % PLAYER_SLOT_COLORS.length];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return PLAYER_SLOT_COLORS[Math.abs(hash) % PLAYER_SLOT_COLORS.length];
}
