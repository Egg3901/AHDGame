/**
 * Shared seat-weighted tallying for US presidential veto overrides.
 *
 * A veto override requires a 2/3 supermajority of the *seats* in each chamber.
 * Officials are stored one document per holder, but a single document (an NPP /
 * aggregated bloc, or a player holding a multi-seat delegation) can represent many
 * seats. Every total and tally here is weighted by `seatsHeld` so thresholds are
 * measured against real chamber size, not document counts (Bug #0952).
 *
 * Used by both the turn-time override resolver (billLifecycle) and the read-time
 * bill-detail DTO so the displayed numbers and the enactment decision agree.
 */
import type { ScopedVoteOfficial } from "@/lib/congress/billVoting";

export type OverrideVoteValue = "for" | "against" | "abstain";

export interface ChamberSeatMap {
  /** Total seats held across all house officials. */
  houseSeats: number;
  /** Total seats held across all senate officials. */
  senateSeats: number;
  /** voterKey (characterId string, or `npp_<nppId>`) → chamber + seat weight. */
  seatMap: Map<string, { chamber: "house" | "senate"; seats: number }>;
}

export interface OverrideChamberTally {
  houseFor: number;
  houseAgainst: number;
  senateFor: number;
  senateAgainst: number;
}

/** Per-chamber override result for display: seat-weighted for/against + total seats. */
export interface OverrideChamberDisplay {
  house: { for: number; against: number; seats: number };
  senate: { for: number; against: number; seats: number };
}

/**
 * Build the per-chamber seat totals and a voter→seat map from a list of house/senate
 * officials. Non-legislative office types are ignored. Votes are keyed by player
 * characterId or `npp_<nppId>`, so both keys are indexed.
 */
export function buildChamberSeatMap(officials: ScopedVoteOfficial[]): ChamberSeatMap {
  let houseSeats = 0;
  let senateSeats = 0;
  const seatMap = new Map<string, { chamber: "house" | "senate"; seats: number }>();

  for (const o of officials) {
    const chamber: "house" | "senate" | null =
      o.officeType === "house" ? "house" : o.officeType === "senate" ? "senate" : null;
    if (chamber === null) continue;
    const seats = o.seatsHeld ?? 1;
    if (chamber === "house") houseSeats += seats;
    else senateSeats += seats;
    if (o.characterId) seatMap.set(o.characterId.toString(), { chamber, seats });
    if (o.nppId) seatMap.set(`npp_${o.nppId.toString()}`, { chamber, seats });
  }

  return { houseSeats, senateSeats, seatMap };
}

/**
 * Tally seat-weighted "for"/"against" override votes per chamber. Voters not found
 * in the seat map (no longer seated) and abstentions contribute no weight.
 */
export function tallyOverrideByChamber(
  overrideVotes: Record<string, OverrideVoteValue> | undefined,
  { seatMap }: ChamberSeatMap
): OverrideChamberTally {
  const tally: OverrideChamberTally = {
    houseFor: 0,
    houseAgainst: 0,
    senateFor: 0,
    senateAgainst: 0,
  };
  if (!overrideVotes) return tally;

  for (const [voterId, vote] of Object.entries(overrideVotes)) {
    if (vote !== "for" && vote !== "against") continue;
    const entry = seatMap.get(voterId);
    if (!entry) continue;
    if (entry.chamber === "house") {
      if (vote === "for") tally.houseFor += entry.seats;
      else tally.houseAgainst += entry.seats;
    } else {
      if (vote === "for") tally.senateFor += entry.seats;
      else tally.senateAgainst += entry.seats;
    }
  }

  return tally;
}

/**
 * Build the per-chamber display shape (seat-weighted for/against + total seats per
 * chamber) used by the bill-detail DTO to render the override progress against the
 * true 2/3-of-seats threshold.
 */
export function buildOverrideDisplay(
  overrideVotes: Record<string, OverrideVoteValue> | undefined,
  seatData: ChamberSeatMap
): OverrideChamberDisplay {
  const t = tallyOverrideByChamber(overrideVotes, seatData);
  return {
    house: { for: t.houseFor, against: t.houseAgainst, seats: seatData.houseSeats },
    senate: { for: t.senateFor, against: t.senateAgainst, seats: seatData.senateSeats },
  };
}
