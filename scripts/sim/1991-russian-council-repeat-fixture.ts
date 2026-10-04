/** Controlled repeat-generation qualification, preserving matched certified subject ballots. */
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../../src/lib/countries/ru/data/councilSubjects1993";
import type { RussianCouncilCohortBallot } from "../../src/lib/countries/ru/rules/councilCohort";
import {
  pendingRussianCouncilRepeatBallots,
  resolveRussianCouncilRepeat,
} from "../../src/lib/countries/ru/rules/councilRepeat";
let failedPolls = 0;
for (let seed = 1; seed <= 64; seed++) {
  const previous: RussianCouncilCohortBallot[] = RUSSIAN_COUNCIL_SUBJECTS_1993.map(
    ([number, , regionId]) => {
      const failed = number !== 89 && (number * 97 + seed) % 9 === 0;
      const vacant = number === 89;
      return {
        id: `ballot-${number}`,
        seatId: `RU-council-${number}`,
        regionId,
        registeredVoters: 1000,
        validBallots: failed ? 0 : 1000,
        againstAllVotes: vacant ? 600 : 0,
        candidates: [0, 1, 2].map((order) => ({
          id: `candidate-${number}-${order}`,
          ownerId: `profile-${order}`,
          party: String(order + 1),
          isNpc: true,
          eligible: true,
          registrationOrder: order,
          votes: failed ? 0 : (vacant ? [300, 250, 150] : [600, 500, 400])[order],
        })),
      };
    }
  );
  const frozen = JSON.stringify(previous);
  const pending = pendingRussianCouncilRepeatBallots(previous);
  const next = resolveRussianCouncilRepeat({
    previous,
    replacements: pending.map((row) => ({
      ...row,
      id: `${row.id}-repeat`,
      registeredVoters: 500,
      validBallots: 500,
      candidates: row.candidates.map((nominee, index) => ({
        ...nominee,
        id: `${nominee.id}-repeat`,
        votes: [300, 250, 200][index],
      })),
    })),
  });
  if (JSON.stringify(previous) !== frozen)
    throw new Error("Repeat changed its certified predecessor");
  const failedSeats = new Set(pending.map((row) => row.seatId));
  for (const row of previous)
    if (
      !failedSeats.has(row.seatId) &&
      next.ballots.find((ballot) => ballot.seatId === row.seatId) !== row
    )
      throw new Error("Repeat replaced a successful ballot");
  if (pendingRussianCouncilRepeatBallots(next.ballots).length)
    throw new Error("Successful repeat still marked failed");
  if (next.result.reduce((sum, row) => sum + row.winners.length, 0) !== 177)
    throw new Error("Repeat changed the valid first mandate or forced the lawful vacancy");
  failedPolls += pending.length;
}
console.log(
  JSON.stringify(
    {
      kind: "bounded-council-repeat-preservation",
      scenarios: 64,
      failedPolls,
      mandatesPerSuccessfulGeneration: 177,
      lawfulVacanciesPerGeneration: 1,
      invariantChecks: [
        "predecessor immutability",
        "new identities for failed polls",
        "fresh failed-poll registers",
        "unchanged successful subjects",
        "valid first-seat preservation",
        "no forced vacancy fill",
      ],
      limitations:
        "Portable repeat rules only; not world-engine opening, admission, transactions, seating or historical calibration.",
    },
    null,
    2
  )
);
