/** Bounded Council preference simulation with matched first-choice weights; no database. */
import { russianCouncilVoteTotals } from "../../src/lib/countries/ru/rules/councilVoteTotals";
import { resolveRussianCouncilBallot } from "../../src/lib/countries/ru/rules/councilResult";

let scenarios = 0;
let validBallots = 0;
let candidateMarks = 0;
let secondMarks = 0;
const outcomes: Record<string, number> = {};
for (let seed = 1; seed <= 64; seed++) {
  for (const register of [0, 1, 1000, 1_000_000]) {
    for (const approval of [0, 50, 100]) {
      const nominees = Array.from({ length: 6 }, (_, index) => ({
        id: `nominee-${index}`,
        registrationOrder: index,
        economicLean: ((seed + index * 3) % 11) - 5,
        socialLean: ((seed * 3 + index * 7) % 11) - 5,
        favorability: approval,
      }));
      const rawVotes = Object.fromEntries(
        nominees.map((row, index) => [
          row.id,
          Math.floor((register * (((((seed + index * 97) * 2654435761) >>> 0) % 100) + 1)) / 500),
        ])
      );
      let votes: Record<string, number> = {};
      let ledger: ReturnType<typeof russianCouncilVoteTotals>["ledger"] | undefined;
      for (let turn = 0; turn < 12; turn++) {
        const input = { registeredVoters: register, priorVotes: votes, ledger, rawVotes, nominees };
        const result = russianCouncilVoteTotals(input);
        const reversed = russianCouncilVoteTotals({ ...input, nominees: [...nominees].reverse() });
        for (const row of nominees)
          if (result.votes[row.id] !== reversed.votes[row.id])
            throw new Error("Nominee iteration order changed vote accumulation");
        if (
          result.ledger.validBallots > register ||
          result.ledger.validBallots < (ledger?.validBallots ?? 0)
        )
          throw new Error("Frozen electorate cap or cumulative participation failed");
        const marks = Object.values(result.votes).reduce((sum, n) => sum + n, 0);
        if (marks < result.ledger.validBallots || marks > 2 * result.ledger.validBallots)
          throw new Error("One-or-two marks per valid ballot failed");
        for (const batch of result.batches)
          if (batch.choices.length > 2 || new Set(batch.choices).size !== batch.choices.length)
            throw new Error("A voter marked the same nominee twice");
        if (approval === 0 && marks !== result.ledger.validBallots)
          throw new Error("Unapproved alternatives received second marks");
        votes = result.votes;
        ledger = result.ledger;
      }
      const result = resolveRussianCouncilBallot({
        ...ledger!,
        options: nominees.map((row) => ({ ...row, votes: votes[row.id] })),
      });
      if (
        result.outcome === "elected" &&
        new Set(result.winnerIds).size !== result.winnerIds.length
      )
        throw new Error("One nominee received both mandates");
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      const marks = Object.values(votes).reduce((sum, n) => sum + n, 0);
      validBallots += ledger!.validBallots;
      candidateMarks += marks;
      secondMarks += marks - ledger!.validBallots;
      scenarios++;
    }
  }
}
console.log(
  JSON.stringify(
    {
      kind: "bounded-council-preferences-matched-first-choices",
      scenarios,
      turnsPerScenario: 12,
      validBallots,
      candidateMarks,
      secondMarks,
      outcomes,
      limitations:
        "Controlled portable-rule preferences, not a full world or historical turnout calibration.",
      invariantChecks: [
        "frozen electorate cap",
        "one or two distinct marks",
        "stable input order",
        "approval-dependent second choices",
        "one nominee mandate",
      ],
    },
    null,
    2
  )
);
