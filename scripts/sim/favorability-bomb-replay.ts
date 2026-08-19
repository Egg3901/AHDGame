/**
 * Favorability-bomb replay — READ ONLY.
 *
 * Prices a coordinated attack campaign. Runs the REAL presidential engine in
 * dry-run mode across a sweep of forced favorability values for the incumbent,
 * and reports what each level is worth in national vote share and electoral
 * votes over the vote still to be cast.
 *
 * Context: `supportPlayer` / `attackPlayer` move favorability by a flat +/-1
 * with no cooldown, no per-turn cap and no dedupe — limited only by action
 * points and the attacker's own infamy. Favorability then multiplies the whole
 * vote via `approvalScalar`, so this is the highest-leverage lever in the game
 * and its size has never been measured.
 *
 * Run: npx tsx scripts/sim/favorability-bomb-replay.ts
 */

import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  accumulatePresidentVoteTurn,
  type PresidentVoteTurnDryRun,
} from "@/lib/presidentialElectionEngine";
import { turnVoteWeight } from "@/lib/electionEngine/voteCalculations";

const COUNTRY = process.env.COUNTRY ?? "US";
/** Favorability levels to price. 100 = today (no attack). */
const SWEEP = (process.env.SWEEP ?? "100,80,60,40,20,0").split(",").map(Number);

function share(votes: Record<string, number>, who: string): number {
  const total = Object.values(votes).reduce((s, v) => s + v, 0);
  return total > 0 ? (100 * (votes[who] ?? 0)) / total : 0;
}

async function main() {
  const db = await getDb();

  const election = await db
    .collection("elections")
    .findOne({ countryId: COUNTRY, electionType: "president", status: "active" });
  if (!election) throw new Error(`no active ${COUNTRY} presidential election`);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const currentTurn = (gs?.currentTurn as number) ?? 0;
  const endTurn = (election.endTurn as number) ?? currentTurn;
  const generalStart = (election.primaryEndTurn as number) ?? (election.startTurn as number) ?? 0;

  const tally = await db
    .collection("electionVoteTallies")
    .findOne({ electionId: election._id as ObjectId });
  const unitBefore = (tally?.totalVotesByUnit ?? {}) as Record<string, Record<string, number>>;
  const names = (tally?.candidateNames ?? {}) as Record<string, string>;

  const incumbentChar = await db
    .collection("characters")
    .findOne({ countryId: COUNTRY, "currentOffice.type": "president" });
  const incCand = await db
    .collection("electionCandidates")
    .findOne({ electionId: election._id, characterId: incumbentChar?._id });
  const INC = String(incCand?._id ?? "");
  if (!INC) throw new Error("could not identify the incumbent's candidacy");

  const evByState = new Map<string, number>();
  await db
    .collection("states")
    .find({ countryId: COUNTRY })
    .forEach((s) => {
      evByState.set(String(s._id), ((s.houseDistricts as number) ?? 0) + 2);
    });

  // Fraction of the pool still uncast, from the production surge curve.
  const totalTurns = Math.max(4, endTurn - generalStart);
  let castFrac = 0;
  for (let t = generalStart; t <= currentTurn && t < endTurn; t++) {
    castFrac += turnVoteWeight(
      totalTurns,
      Math.max(0, Math.min(t - generalStart, totalTurns - 1)),
      1
    );
  }
  const remaining = Math.max(0, Math.min(1, 1 - castFrac));

  // Current cumulative standing.
  let cumIncAll = 0;
  let cumAll = 0;
  for (const before of Object.values(unitBefore)) {
    cumIncAll += before[INC] ?? 0;
    cumAll += Object.values(before).reduce((s, v) => s + v, 0);
  }
  const cumNational = cumAll > 0 ? (100 * cumIncAll) / cumAll : 0;

  console.log(`\n${"=".repeat(76)}`);
  console.log(`FAVORABILITY BOMB — ${COUNTRY} president, incumbent ${names[INC] ?? INC}`);
  console.log(
    `turn ${currentTurn}, ends ${endTurn} | pool uncast ${(remaining * 100).toFixed(1)}%`
  );
  console.log(`current cumulative standing: ${cumNational.toFixed(2)}%`);
  console.log(`${"=".repeat(76)}\n`);
  console.log("  fav   marginal%   projected final%    EV(inc)   EV(chal)   flips");
  console.log("  " + "-".repeat(68));

  for (const fav of SWEEP) {
    const run = (await accumulatePresidentVoteTurn(
      election._id as ObjectId,
      currentTurn + 1,
      new Date(),
      { dryRun: true, favorabilityOverride: { [INC]: fav } }
    )) as PresidentVoteTurnDryRun;

    let evInc = 0;
    let evChal = 0;
    const flips: string[] = [];
    let margIncAll = 0;
    let margAll = 0;

    for (const [state, before] of Object.entries(unitBefore)) {
      const after = run.totalVotesByUnit[state];
      if (!after) continue;
      const marginal: Record<string, number> = {};
      for (const id of run.candidateIds) marginal[id] = (after[id] ?? 0) - (before[id] ?? 0);
      margIncAll += marginal[INC] ?? 0;
      margAll += Object.values(marginal).reduce((s, v) => s + v, 0);

      const cumTotal = Object.values(before).reduce((s, v) => s + v, 0);
      const cumShare = cumTotal > 0 ? (100 * (before[INC] ?? 0)) / cumTotal : 0;
      const margShare = share(marginal, INC);
      const projected = cumShare * (1 - remaining) + margShare * remaining;

      const ev = evByState.get(state) ?? 0;
      if (projected > 50) evInc += ev;
      else {
        evChal += ev;
        if (cumShare > 50) flips.push(state);
      }
    }

    const margNational = margAll > 0 ? (100 * margIncAll) / margAll : 0;
    const projNational = cumNational * (1 - remaining) + margNational * remaining;

    console.log(
      `  ${String(fav).padStart(3)}   ${margNational.toFixed(2).padStart(8)}   ` +
        `${projNational.toFixed(2).padStart(15)}    ${String(evInc).padStart(6)}   ` +
        `${String(evChal).padStart(7)}   ${flips.length}`
    );
  }

  console.log("\n" + "=".repeat(76));
  console.log("marginal% = incumbent's share of THIS turn's votes at that favorability");
  console.log("projected = locked-in cumulative blended with the uncast remainder");
  console.log("270 EV wins. Attack moves favorability -1 per action, no cap, no cooldown.");
  console.log("=".repeat(76) + "\n");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
