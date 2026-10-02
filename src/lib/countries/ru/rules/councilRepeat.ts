/**
 * Failed Council polls repeat while valid subject results and first seats remain frozen.
 * pendingRussianCouncilRepeatBallots excludes lawful second-seat vacancies;
 * resolveRussianCouncilRepeat replaces only failed polls with new ballot identities.
 * Article32: https://sudact.ru/law/ukaz-prezidenta-rf-ot-11101993-n-1626/
 */
import {
  resolveRussianCouncilAccumulatedCohort,
  type RussianCouncilCohortBallot,
} from "./councilCohort";

export function pendingRussianCouncilRepeatBallots(ballots: readonly RussianCouncilCohortBallot[]) {
  const decisions = new Map(
    resolveRussianCouncilAccumulatedCohort(ballots).map((row) => [row.seatId, row.decision])
  );
  return [...ballots]
    .filter((row) => decisions.get(row.seatId)?.outcome === "repeat")
    .sort(
      (a, b) =>
        Number(a.seatId.slice("RU-council-".length)) - Number(b.seatId.slice("RU-council-".length))
    );
}

export function resolveRussianCouncilRepeat(input: {
  previous: readonly RussianCouncilCohortBallot[];
  replacements: readonly RussianCouncilCohortBallot[];
}) {
  const pending = pendingRussianCouncilRepeatBallots(input.previous);
  const expected = new Map(pending.map((row) => [row.seatId, row]));
  const oldIds = new Set(input.previous.map((row) => row.id));
  const replacements = new Map(input.replacements.map((row) => [row.seatId, row]));
  if (
    !pending.length ||
    input.replacements.length !== pending.length ||
    replacements.size !== pending.length ||
    new Set(input.replacements.map((row) => row.id)).size !== pending.length ||
    input.replacements.some(
      (row) => !row.id || oldIds.has(row.id) || expected.get(row.seatId)?.regionId !== row.regionId
    )
  )
    throw new Error("Council repeats must replace exactly the failed polls with new identities");
  const ballots = input.previous.map((row) => replacements.get(row.seatId) ?? row);
  const players = input.replacements.flatMap((row) =>
    row.candidates.filter((candidate) => !candidate.isNpc).map((candidate) => candidate.ownerId)
  );
  if (new Set(players).size !== players.length)
    throw new Error("A player cannot contest multiple polls in one Council repeat generation");
  const result = resolveRussianCouncilAccumulatedCohort(ballots);
  return { ballots, result };
}
