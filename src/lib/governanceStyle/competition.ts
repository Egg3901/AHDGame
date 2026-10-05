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
  /** Constitutional system, independent of whether an executive is currently seated. */
  executiveSystem: "presidential" | "parliamentary";
  /** Null when the country has no separately elected executive. */
  executiveAlignedWithLegislature: boolean | null;
  uninterruptedControlTurns: number;
  consecutiveExecutiveTerms: number;
  seatMarginPenalty: number;
  legislativeContinuityPenalty: number;
  executiveContinuityPenalty: number;
  /** Largest scored Court bloc, or null when the Court is too empty or entirely unclassified. */
  courtDominantBloc: "liberal" | "conservative" | "party_fallback" | null;
  /** Share of all seated justices in the largest scored bloc, 0-100. */
  courtDominantShare: number;
  courtSeated: number;
  courtLiberalSeats: number;
  courtSwingSeats: number;
  courtConservativeSeats: number;
  courtUnclassifiedSeats: number;
  courtPenalty: number;
  penalty: number;
}

export interface CourtJusticeAlignment {
  economicLean: number | null;
  socialLean: number | null;
  /** Used only when the justice has no usable lean data. */
  partyId?: string | null;
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
 * Ideological concentration of the seated Supreme Court. A justice is liberal
 * below -1 average lean, conservative above +1, and a swing justice between
 * those bounds. Swing and unclassified justices remain in the denominator, so
 * neither ideological bloc can claim them. Appointing party is only a fallback
 * for a justice whose lean data is unavailable. Penalty starts above a two-thirds
 * bloc and scales to a 12-point cap for a unanimous bench. Courts with fewer
 * than 5 seated justices are too empty to score concentration.
 */
export function assessCourtConcentration(justices: readonly CourtJusticeAlignment[] = []): {
  courtDominantBloc: "liberal" | "conservative" | "party_fallback" | null;
  courtDominantShare: number;
  courtSeated: number;
  courtLiberalSeats: number;
  courtSwingSeats: number;
  courtConservativeSeats: number;
  courtUnclassifiedSeats: number;
  courtPenalty: number;
} {
  const seated = justices.length;
  let liberal = 0;
  let swing = 0;
  let conservative = 0;
  let unclassified = 0;
  const fallbackParties = new Map<string, number>();

  for (const justice of justices) {
    if (Number.isFinite(justice.economicLean) && Number.isFinite(justice.socialLean)) {
      const averageLean = ((justice.economicLean as number) + (justice.socialLean as number)) / 2;
      if (averageLean < -1) liberal += 1;
      else if (averageLean > 1) conservative += 1;
      else swing += 1;
    } else if (justice.partyId) {
      unclassified += 1;
      fallbackParties.set(justice.partyId, (fallbackParties.get(justice.partyId) ?? 0) + 1);
    } else {
      unclassified += 1;
    }
  }

  if (seated < 5) {
    return {
      courtDominantBloc: null,
      courtDominantShare: 0,
      courtSeated: seated,
      courtLiberalSeats: liberal,
      courtSwingSeats: swing,
      courtConservativeSeats: conservative,
      courtUnclassifiedSeats: unclassified,
      courtPenalty: 0,
    };
  }

  const ideologicalEntries = [
    ["liberal", liberal],
    ["conservative", conservative],
  ] as const;
  const strongestIdeological = [...ideologicalEntries].sort((a, b) => b[1] - a[1])[0];
  const strongestFallback = [...fallbackParties.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const useFallback = Boolean(strongestFallback && strongestFallback[1] > strongestIdeological[1]);
  const bloc = useFallback ? "party_fallback" : strongestIdeological[0];
  const count = useFallback ? strongestFallback![1] : strongestIdeological[1];
  const share = (count / seated) * 100;
  const twoThirds = 2 / 3;
  const concentration = count / seated;
  const penalty =
    concentration <= twoThirds
      ? 0
      : clamp(((concentration - twoThirds) / (1 - twoThirds)) * 12, 0, 12);
  return {
    courtDominantBloc: count > 0 ? bloc : null,
    courtDominantShare: Math.round(share * 10) / 10,
    courtSeated: seated,
    courtLiberalSeats: liberal,
    courtSwingSeats: swing,
    courtConservativeSeats: conservative,
    courtUnclassifiedSeats: unclassified,
    courtPenalty: Math.round(penalty * 10) / 10,
  };
}

/**
 * Competitive-balance pressure for a liberal democracy. A normal majority has
 * no cost. Large seat monopolies cost health immediately. Uninterrupted chamber
 * leadership and repeated executive wins add slower pressure, but presidential
 * tenure compounds legislative dominance only when the same party holds both.
 * An ideologically concentrated Supreme Court is a separate sliding cost.
 */
export function assessDemocraticCompetition(input: {
  seatsByParty?: Record<string, number>;
  chambersByParty?: readonly Record<string, number>[];
  history?: readonly SeatControlHistoryRow[];
  executivePartyId?: string | null;
  executiveSystem?: "presidential" | "parliamentary";
  consecutiveExecutiveTerms?: number;
  justices?: readonly CourtJusticeAlignment[];
}): DemocraticCompetition {
  const current = tallyChambers(input.chambersByParty ?? [input.seatsByParty ?? {}]);
  const executivePartyId = input.executivePartyId || null;
  const executiveAligned = executivePartyId ? executivePartyId === current.party : null;
  const continuityPartyId = executivePartyId ?? current.party;
  const controlTurns = uninterruptedControlTurns(continuityPartyId, input.history ?? []);
  const executiveTerms = Math.max(0, Math.floor(input.consecutiveExecutiveTerms ?? 0));
  const court = assessCourtConcentration(input.justices);

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
    executiveSystem:
      input.executiveSystem ??
      (input.executivePartyId !== undefined ? "presidential" : "parliamentary"),
    executiveAlignedWithLegislature: executiveAligned,
    uninterruptedControlTurns: controlTurns,
    consecutiveExecutiveTerms: executiveTerms,
    seatMarginPenalty: roundedSeatPenalty,
    legislativeContinuityPenalty: roundedLegislativeContinuityPenalty,
    executiveContinuityPenalty: roundedExecutiveContinuityPenalty,
    ...court,
    penalty:
      Math.round(
        (seatPenalty +
          legislativeContinuityPenalty +
          executiveContinuityPenalty +
          court.courtPenalty) *
          10
      ) / 10,
  };
}
