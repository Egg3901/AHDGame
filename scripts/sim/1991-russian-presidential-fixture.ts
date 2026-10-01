/** A bounded matched-seed rules simulation; it never connects to a database. */
import { russianPresidentialVoteIncrement } from "../../src/lib/countries/ru/rules/presidentialVoteIncrement";
import { decideRussianPresidentialResult } from "../../src/lib/countries/ru/rules/presidentialResult";

const registeredVoters = 1_000_000;
const candidates = ["candidate-a", "candidate-b", "candidate-c"];
const scenarios = [];
for (let seed = 1; seed <= 32; seed++) {
  // The same generated preferences drive each matched baseline/support pair.
  const jitter = ((seed * 2654435761) >>> 0) % 11;
  const weights = [40 + jitter, 40 - jitter, 20];
  for (const turnout of [0.25, 0.5, 0.75, 1]) {
    const target = registeredVoters * turnout;
    let baselineVotes: Record<string, number> | undefined;
    for (const strength of [0, 50_000, 150_000]) {
      let totalVotes: Record<string, number> = {};
      for (let turn = 0; turn < 2; turn++) {
        const rawVotes = Object.fromEntries(
          candidates.map((id, i) => [id, ((target / 2) * weights[i]) / 100])
        );
        const increments = russianPresidentialVoteIncrement({
          registeredVoters,
          priorVotes: totalVotes,
          rawVotes,
          campaignStrength: { "candidate-a": strength },
        });
        totalVotes = Object.fromEntries(
          candidates.map((id) => [id, (totalVotes[id] ?? 0) + increments[id]])
        );
      }
      const participants = Object.values(totalVotes).reduce((sum, n) => sum + n, 0);
      if (participants !== target || participants > registeredVoters)
        throw new Error("Participation conservation failed");
      if (strength === 0) baselineVotes = totalVotes;
      else if (totalVotes["candidate-a"] <= baselineVotes!["candidate-a"])
        throw new Error("Paid strength had no ballot effect");
      const result = decideRussianPresidentialResult({
        round: 1,
        candidateIds: candidates,
        votesFor: totalVotes,
        votesAgainst: Object.fromEntries(
          candidates.map((id) => [id, participants - totalVotes[id]])
        ),
        registeredVoters,
        participants,
      });
      if (turnout < 0.5 && (result.outcome !== "repeat" || result.reason !== "low-turnout"))
        throw new Error("An invalid turnout elected a president");
      if (result.outcome === "won" && totalVotes[result.winnerCandidateId] * 2 <= participants)
        throw new Error("A minority won the first ballot");
      scenarios.push({ seed, turnout, strength, participants, totalVotes, result });
    }
  }
}
console.log(
  JSON.stringify(
    {
      kind: "bounded-rules-matched-seed",
      scenarios: scenarios.length,
      registeredVoters,
      invariantChecks: [
        "matched preferences",
        "exact fixed participation",
        "campaign strength has a vote effect",
        "low turnout cannot seat",
        "first-round majority required",
      ],
      outcomes: scenarios.reduce<Record<string, number>>((counts, scenario) => {
        counts[scenario.result.outcome] = (counts[scenario.result.outcome] ?? 0) + 1;
        return counts;
      }, {}),
      samples: scenarios.filter((scenario) => scenario.seed === 1),
    },
    null,
    2
  )
);
