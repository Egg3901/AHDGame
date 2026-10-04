/**
 * First-Council certification counts all 89 subject ballots before seating members.
 * resolveRussianCouncilCohort preserves lawful vacancies and rejects incomplete
 * boundaries, duplicate candidacies and multiple mandates for a player.
 */
import { planRussianCouncilDistricts } from "./councilDistricts";
import { resolveRussianCouncilBallot, type RussianCouncilVoteOption } from "./councilResult";

export interface RussianCouncilCohortCandidate extends RussianCouncilVoteOption {
  ownerId: string;
  party: string;
  isNpc: boolean;
  /** Owner existence, residence, retirement and incompatibility checked by the host. */
  eligible: boolean;
}

export interface RussianCouncilCohortBallot {
  id: string;
  seatId: string;
  regionId: string;
  registeredVoters: number;
  validBallots: number;
  againstAllVotes: number;
  invalidated?: boolean;
  candidates: readonly RussianCouncilCohortCandidate[];
}

export function resolveRussianCouncilCohort(ballots: readonly RussianCouncilCohortBallot[]) {
  return resolveRussianCouncilBallots(ballots, false);
}

/** Historical losing nominations do not bar an owner from a later failed-poll generation. */
export function resolveRussianCouncilAccumulatedCohort(
  ballots: readonly RussianCouncilCohortBallot[]
) {
  return resolveRussianCouncilBallots(ballots, true);
}

function resolveRussianCouncilBallots(
  ballots: readonly RussianCouncilCohortBallot[],
  accumulated: boolean
) {
  if (
    ballots.length !== 89 ||
    new Set(ballots.map((row) => row.id)).size !== 89 ||
    new Set(ballots.map((row) => row.seatId)).size !== 89 ||
    ballots.some((row) => !row.id)
  )
    throw new Error("First-Council certification needs 89 unique subject ballots");
  const boundaries = new Map(
    planRussianCouncilDistricts(
      Object.fromEntries(ballots.map((row) => [row.seatId, row.registeredVoters]))
    ).map((row) => [row.seatId, row])
  );
  if (ballots.some((row) => boundaries.get(row.seatId)?.regionId !== row.regionId))
    throw new Error("Council subject ballots must retain their original macroregion");
  const candidates = ballots.flatMap((row) => [...row.candidates]);
  if (
    new Set(candidates.map((row) => row.id)).size !== candidates.length ||
    candidates.some(
      (row) =>
        !row.ownerId ||
        !row.party ||
        typeof row.isNpc !== "boolean" ||
        typeof row.eligible !== "boolean"
    )
  )
    throw new Error("Council nominees need unique candidacies and identified eligible owners");
  const players = candidates.filter((row) => !row.isNpc).map((row) => row.ownerId);
  if (!accumulated && new Set(players).size !== players.length)
    throw new Error("A player cannot contest multiple Council subject mandates");
  const results = [...ballots]
    .sort(
      (a, b) => boundaries.get(a.seatId)!.districtNumber - boundaries.get(b.seatId)!.districtNumber
    )
    .map((ballot) => {
      const decision = resolveRussianCouncilBallot({ ...ballot, options: ballot.candidates });
      if (decision.outcome === "repeat")
        return {
          electionId: ballot.id,
          seatId: ballot.seatId,
          regionId: ballot.regionId,
          decision,
          winners: [],
          vacancies: 2,
        };
      const nominees = new Map(ballot.candidates.map((row) => [row.id, row]));
      const winners = decision.winnerIds.map((id) => nominees.get(id)!);
      if (winners.some((row) => !row.eligible))
        return {
          electionId: ballot.id,
          seatId: ballot.seatId,
          regionId: ballot.regionId,
          decision: {
            outcome: "repeat" as const,
            validBallots: decision.validBallots,
            reason: "ineligible-winner" as const,
          },
          winners: [],
          vacancies: 2,
        };
      return {
        electionId: ballot.id,
        seatId: ballot.seatId,
        regionId: ballot.regionId,
        decision,
        winners,
        vacancies: decision.vacancies,
      };
    });
  const playerWinners = results.flatMap((row) =>
    row.winners.filter((winner) => !winner.isNpc).map((winner) => winner.ownerId)
  );
  if (new Set(playerWinners).size !== playerWinners.length)
    throw new Error("A player cannot hold multiple Council subject mandates");
  return results;
}
