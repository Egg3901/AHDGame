import { allocateSeats, type MajoritarianBonusConfig } from "@/lib/turn/election/seatAllocation";
import { MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";
import { HOUSE_SEATS } from "@/lib/constants";

/**
 * Derives seat counts from cumulative vote totals for a single turn snapshot.
 * Used when older tallies omitted `seatsEstimate` on `turnSnapshots` so the
 * election detail UI can still plot seat history alongside vote share.
 *
 * `houseSeats` defaults to the 2020-census `HOUSE_SEATS`; pass
 * `getHouseSeats(preset)` to estimate with the active preset's apportionment.
 */
export function seatEstimateForVoteTotals(
  electionType: string,
  state: string | undefined,
  totalSeats: number | null | undefined,
  cumulativeVotes: Record<string, number>,
  houseSeats: Record<string, number> = HOUSE_SEATS,
  candidateParties?: Record<string, string>,
  // FPTP winner's bonus (#3244) — pass getMajoritarianBonus(electionType,
  // gameState.currentYear) so backfilled snapshot estimates match resolution
  // in historical in-game years (pre-1999).
  majoritarianBonus?: MajoritarianBonusConfig
): Record<string, number> | undefined {
  if (!totalSeats || totalSeats <= 1 || !MULTI_SEAT_TYPES.has(electionType)) return undefined;

  const ranked = Object.entries(cumulativeVotes)
    .map(([id, votes]) => ({
      id,
      votes: Math.round(votes ?? 0),
      // Enables party-aggregate min-share eligibility in allocateSeats;
      // omitted → legacy per-candidate threshold.
      party: candidateParties?.[id],
    }))
    .filter((r) => r.votes > 0)
    .sort((a, b) => b.votes - a.votes);

  const totalVotesCast = ranked.reduce((s, r) => s + r.votes, 0);
  if (totalVotesCast === 0 || ranked.length === 0) return undefined;

  const { seatsEstimate } = allocateSeats(
    electionType,
    state,
    totalSeats,
    ranked,
    totalVotesCast,
    houseSeats,
    majoritarianBonus
  );
  return Object.keys(seatsEstimate).length > 0 ? seatsEstimate : undefined;
}
