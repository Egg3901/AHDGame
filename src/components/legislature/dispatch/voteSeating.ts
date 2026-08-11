/** Vote-category colors for bars/legends — full-strength theme tokens. */
export const VOTE_COLORS = {
  for: "var(--success)",
  against: "var(--error)",
  abstain: "var(--muted)",
  pending: "color-mix(in srgb, var(--muted) 32%, transparent)",
} as const;

/**
 * Softer palette for the seating-chart seats — the for/against tokens blended
 * toward the card background so a chamber full of dots reads as muted green/red
 * (editorial, not neon) while staying theme-token-driven across all themes.
 */
export const SEAT_VOTE_COLORS = {
  for: "color-mix(in srgb, var(--success) 72%, var(--card))",
  against: "color-mix(in srgb, var(--error) 72%, var(--card))",
  abstain: "color-mix(in srgb, var(--muted) 70%, var(--card))",
  pending: "color-mix(in srgb, var(--muted) 26%, transparent)",
} as const;

export interface VoteCounts {
  for: number;
  abstain: number;
  against: number;
}

/**
 * Resolve the pass threshold for a chamber of `eligible` seats.
 *
 * - With no `requiredPct`, a simple majority of seats applies (floor/2 + 1) and
 *   the displayed percentage is rounded up so a near-half chamber (e.g. the
 *   435-seat House at 50.1%) never reads as "50%".
 * - With an explicit `requiredPct` (filibuster cloture = 60%, two-thirds = 67%),
 *   the seat count is that fraction of seats, rounded up, and the displayed
 *   percentage is the supplied value verbatim.
 *
 * `need` drives the "passing" color; `displayPct` drives the caption.
 */
export function seatingThreshold(
  eligible: number,
  requiredPct?: number
): { need: number; displayPct: number } {
  if (requiredPct != null) {
    return { need: Math.ceil((eligible * requiredPct) / 100), displayPct: requiredPct };
  }
  const need = Math.floor(eligible / 2) + 1;
  return { need, displayPct: Math.ceil((need / eligible) * 100) };
}

export interface SeatPalette {
  for: string;
  against: string;
  abstain: string;
  pending: string;
}

/**
 * Produce a per-seat color array for a chamber of `totalSeats`, laying seats out
 * in the order: for → abstain → pending (not-yet-voted) → against. Pending is the
 * gap between cast votes and total seats. Always returns exactly `totalSeats`
 * entries (truncating if the tally somehow exceeds the chamber size).
 */
export function seatVoteColors(
  votes: VoteCounts,
  totalSeats: number,
  palette: SeatPalette = VOTE_COLORS
): string[] {
  const cast = votes.for + votes.abstain + votes.against;
  const pending = Math.max(0, totalSeats - cast);
  const order: Array<[number, string]> = [
    [votes.for, palette.for],
    [votes.abstain, palette.abstain],
    [pending, palette.pending],
    [votes.against, palette.against],
  ];
  const colors: string[] = [];
  for (const [n, color] of order) {
    for (let k = 0; k < n && colors.length < totalSeats; k++) colors.push(color);
  }
  while (colors.length < totalSeats) colors.push(palette.pending);
  return colors.slice(0, totalSeats);
}
