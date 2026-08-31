export interface SeatControlHistoryRow {
  turn: number;
  party: string;
  seats: number;
  officeType?: string;
}

export interface DemocraticCompetition {
  dominantPartyId: string | null;
  /** Equal-chamber average held by the dominant party. */
  dominantSeatShare: number;
  chambersMeasured: number;
  executivePartyId: string | null;
  /** Null when the country has no separately elected executive. */
  executiveAlignedWithLegislature: boolean | null;
  uninterruptedControlTurns: number;
  consecutiveExecutiveTerms: number;
  seatMarginPenalty: number;
  legislativeContinuityPenalty: number;
  executiveContinuityPenalty: number;
  penalty: number;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function tallyChambers(chambersByParty: readonly Record<string, number>[]) {
  const validChambers = chambersByParty.filter((chamber) =>
    Object.values(chamber).some((seats) => Number.isFinite(seats) && seats > 0)
  );
  const averageShares = new Map<string, number>();

  for (const chamber of validChambers) {
    const entries = Object.entries(chamber).filter(
      ([, seats]) => Number.isFinite(seats) && seats > 0
    );
    const total = entries.reduce((sum, [, seats]) => sum + seats, 0);
    for (const [party, seats] of entries) {
      averageShares.set(party, (averageShares.get(party) ?? 0) + seats / total);
    }
  }

  const dominant = [...averageShares.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  return {
    party: dominant?.[0] ?? null,
    share: dominant && validChambers.length > 0 ? dominant[1] / validChambers.length : 0,
    chambersMeasured: validChambers.length,
  };
}

function uninterruptedControlTurns(
  dominantPartyId: string | null,
  history: readonly SeatControlHistoryRow[]
): number {
  if (!dominantPartyId || history.length === 0) return 0;
  const byTurn = new Map<number, Map<string, Record<string, number>>>();
  for (const row of history) {
    if (!Number.isFinite(row.turn) || !Number.isFinite(row.seats) || row.seats <= 0) continue;
    const chambers = byTurn.get(row.turn) ?? new Map<string, Record<string, number>>();
    const chamberKey = row.officeType ?? "default";
    const seats = chambers.get(chamberKey) ?? {};
    seats[row.party] = (seats[row.party] ?? 0) + row.seats;
    chambers.set(chamberKey, seats);
    byTurn.set(row.turn, chambers);
  }

  const turns = [...byTurn.keys()].sort((a, b) => b - a);
  let count = 0;
  for (const turn of turns) {
    const leader = tallyChambers([...byTurn.get(turn)!.values()]).party;
    if (leader !== dominantPartyId) break;
    count++;
  }
  return count;
}

/**
 * Competitive-balance pressure for a liberal democracy. A normal majority has
 * no cost. Large seat monopolies cost health immediately. Uninterrupted chamber
 * leadership and repeated executive wins add slower pressure, but presidential
 * tenure compounds legislative dominance only when the same party holds both.
 */
export function assessDemocraticCompetition(input: {
  seatsByParty?: Record<string, number>;
  chambersByParty?: readonly Record<string, number>[];
  history?: readonly SeatControlHistoryRow[];
  executivePartyId?: string | null;
  consecutiveExecutiveTerms?: number;
}): DemocraticCompetition {
  const current = tallyChambers(input.chambersByParty ?? [input.seatsByParty ?? {}]);
  const executivePartyId = input.executivePartyId || null;
  const executiveAligned = executivePartyId ? executivePartyId === current.party : null;
  const continuityPartyId = executivePartyId ?? current.party;
  const controlTurns = uninterruptedControlTurns(continuityPartyId, input.history ?? []);
  const executiveTerms = Math.max(0, Math.floor(input.consecutiveExecutiveTerms ?? 0));

  const seatPenalty = clamp((current.share * 100 - 55) * 0.6, 0, 27);
  const legislativeContinuityPenalty = clamp(((controlTurns - 48) / 48) * 6, 0, 6);
  const executiveContinuityPenalty = executiveAligned ? clamp((executiveTerms - 1) * 2, 0, 8) : 0;
  const roundedSeatPenalty = Math.round(seatPenalty * 10) / 10;
  const roundedLegislativeContinuityPenalty = Math.round(legislativeContinuityPenalty * 10) / 10;
  const roundedExecutiveContinuityPenalty = Math.round(executiveContinuityPenalty * 10) / 10;

  return {
    dominantPartyId: current.party,
    dominantSeatShare: Math.round(current.share * 1000) / 10,
    chambersMeasured: current.chambersMeasured,
    executivePartyId,
    executiveAlignedWithLegislature: executiveAligned,
    uninterruptedControlTurns: controlTurns,
    consecutiveExecutiveTerms: executiveTerms,
    seatMarginPenalty: roundedSeatPenalty,
    legislativeContinuityPenalty: roundedLegislativeContinuityPenalty,
    executiveContinuityPenalty: roundedExecutiveContinuityPenalty,
    penalty:
      Math.round((seatPenalty + legislativeContinuityPenalty + executiveContinuityPenalty) * 10) /
      10,
  };
}
