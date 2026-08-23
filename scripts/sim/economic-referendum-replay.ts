/**
 * Economic-referendum replay harness — READ ONLY.
 *
 * Runs the REAL presidential engine (`accumulatePresidentVoteTurn`) twice over
 * identical live inputs, in dry-run mode so nothing is persisted, and diffs:
 *
 *   A (baseline) — calibration.referendumScale = 0, the channel disabled.
 *   B (variant)  — calibration.referendumScale = 1, production behavior.
 *
 * Same read-only guarantees as `incumbency-approval-replay.ts`: both runs are
 * dry runs, the harness itself only reads, and the live tally is never touched.
 *
 * What it measures:
 *   - the referendum reading (misery index, components, fatigue multiplier)
 *   - the per-state marginal vote-share delta for one turn (engine-measured)
 *   - the national marginal share delta
 *   - projected electoral college and any state flips under the variant
 *
 * Run: npx tsx scripts/sim/economic-referendum-replay.ts
 */

import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  accumulatePresidentVoteTurn,
  type PresidentVoteTurnDryRun,
} from "@/lib/presidentialElectionEngine";
import { turnVoteWeight } from "@/lib/electionEngine/voteCalculations";

const COUNTRY = process.env.COUNTRY ?? "US";
/** Variant scale; 1 is production. Set >1 to probe a stronger channel. */
const VARIANT_SCALE = Number(process.env.REFERENDUM_SCALE ?? 1);

type Row = {
  state: string;
  ev: number;
  baseShare: number;
  variantShare: number;
  shareDelta: number;
};

function pct(votes: Record<string, number>, who: string): number {
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

  const tallyBefore = await db
    .collection("electionVoteTallies")
    .findOne({ electionId: election._id as ObjectId });
  const unitBefore = (tallyBefore?.totalVotesByUnit ?? {}) as Record<
    string,
    Record<string, number>
  >;
  const names = (tallyBefore?.candidateNames ?? {}) as Record<string, string>;

  // Identify the incumbent's candidacy: the sitting president in this race.
  const incumbentChar = await db
    .collection("characters")
    .findOne({ countryId: COUNTRY, "currentOffice.type": "president" });
  const incumbentCandidate = await db
    .collection("electionCandidates")
    .findOne({ electionId: election._id, characterId: incumbentChar?._id });
  const INC = String(incumbentCandidate?._id ?? "");
  if (!INC) throw new Error("could not identify the incumbent's candidacy");

  const evByState = new Map<string, number>();
  await db
    .collection("states")
    .find({ countryId: COUNTRY })
    .forEach((s) => {
      evByState.set(String(s._id), ((s.houseDistricts as number) ?? 0) + 2);
    });

  const now = new Date();
  const nextTurn = currentTurn + 1;

  console.log(`\n${"=".repeat(78)}`);
  console.log(
    `ECONOMIC-REFERENDUM REPLAY — ${COUNTRY} president, turn ${currentTurn} -> ${nextTurn}`
  );
  console.log(`incumbent: ${names[INC] ?? INC} | variant scale ${VARIANT_SCALE}`);
  console.log(`${"=".repeat(78)}\n`);

  const runA = (await accumulatePresidentVoteTurn(election._id as ObjectId, nextTurn, now, {
    dryRun: true,
    referendumScale: 0,
  })) as PresidentVoteTurnDryRun;

  const runB = (await accumulatePresidentVoteTurn(election._id as ObjectId, nextTurn, now, {
    dryRun: true,
    referendumScale: VARIANT_SCALE,
  })) as PresidentVoteTurnDryRun;

  const ref = runB.referendum;
  if (!ref) {
    console.log("no referendum reading — the presidency is vacant, has no party,");
    console.log("or that party fields no candidate in this race. Nothing to measure.\n");
    process.exit(0);
  }

  console.log(`misery index      : ${ref.miseryIndex.toFixed(2)}`);
  console.log(`fatigue multiplier: ${ref.fatigueMultiplier.toFixed(2)}`);
  for (const c of ref.components) {
    console.log(`  ${c.label.padEnd(16)} ${c.contributionPts.toFixed(2).padStart(7)} pts`);
  }
  console.log(
    `raw shift ${ref.sharePts.toFixed(2)} pts  |  applied ${(ref.sharePts * VARIANT_SCALE).toFixed(2)} pts\n`
  );

  const rows: Row[] = [];
  for (const [state, before] of Object.entries(unitBefore)) {
    const a = runA.totalVotesByUnit[state];
    const b = runB.totalVotesByUnit[state];
    if (!a || !b) continue;

    // Marginal (this turn only) = cumulative-after minus cumulative-before.
    const marginal = (src: Record<string, number>) => {
      const out: Record<string, number> = {};
      for (const id of runA.candidateIds) out[id] = (src[id] ?? 0) - (before[id] ?? 0);
      return out;
    };
    const baseShare = pct(marginal(a), INC);
    const variantShare = pct(marginal(b), INC);

    rows.push({
      state,
      ev: evByState.get(state) ?? 0,
      baseShare,
      variantShare,
      shareDelta: variantShare - baseShare,
    });
  }

  rows.sort((x, y) => x.shareDelta - y.shareDelta);

  console.log("state  EV   baseShare  varShare   shareD");
  console.log("-".repeat(46));
  for (const r of rows) {
    console.log(
      `${r.state.padEnd(5)} ${String(r.ev).padStart(3)}  ${r.baseShare.toFixed(2).padStart(8)}  ` +
        `${r.variantShare.toFixed(2).padStart(8)}  ${r.shareDelta.toFixed(3).padStart(7)}`
    );
  }

  const nationalBase = pct(runA.totalVotes, INC);
  const nationalVariant = pct(runB.totalVotes, INC);

  console.log("\n" + "=".repeat(78));
  console.log(
    `per-state share delta  min ${rows[0]?.shareDelta.toFixed(3)}  ` +
      `max ${rows[rows.length - 1]?.shareDelta.toFixed(3)}`
  );
  console.log(
    `national cumulative share  A ${nationalBase.toFixed(3)}  B ${nationalVariant.toFixed(3)}  ` +
      `delta ${(nationalVariant - nationalBase).toFixed(3)}`
  );

  // Project the final standing. Votes already cast are locked; only the votes
  // still to come carry the variant's share delta. The remaining share of the
  // pool comes from the production surge curve (`turnVoteWeight`) over the
  // GENERAL window, not a guess.
  const generalStart = (election.primaryEndTurn as number) ?? (election.startTurn as number) ?? 0;
  const totalTurns = Math.max(4, endTurn - generalStart);
  const POOL = 1;
  let castFrac = 0;
  for (let t = generalStart; t <= currentTurn && t < endTurn; t++) {
    castFrac += turnVoteWeight(
      totalTurns,
      Math.max(0, Math.min(t - generalStart, totalTurns - 1)),
      POOL
    );
  }
  const remainingFrac = Math.max(0, Math.min(1, 1 - castFrac));

  let evBase = 0;
  let evVariant = 0;
  const flips: string[] = [];
  for (const r of rows) {
    const before = unitBefore[r.state];
    const cumTotal = Object.values(before).reduce((s, v) => s + v, 0);
    const cumShare = cumTotal > 0 ? (100 * (before[INC] ?? 0)) / cumTotal : 0;

    const projected = cumShare * (1 - remainingFrac) + r.variantShare * remainingFrac;
    const projectedBase = cumShare * (1 - remainingFrac) + r.baseShare * remainingFrac;

    if (projectedBase > 50) evBase += r.ev;
    if (projected > 50) evVariant += r.ev;
    if (projectedBase > 50 !== projected > 50) flips.push(r.state);
  }

  console.log(`\nturns remaining: ${Math.max(0, endTurn - currentTurn)}`);
  console.log(
    `pool already cast: ${(castFrac * 100).toFixed(1)}%  still to come: ${(remainingFrac * 100).toFixed(1)}%`
  );
  console.log(`EV  baseline (channel off) : ${evBase}`);
  console.log(`EV  variant  (channel on)  : ${evVariant}`);
  console.log(`flips: ${flips.length ? flips.join(", ") : "none"}`);
  console.log("=".repeat(78) + "\n");
  console.log("NOTE: the engine-measured quantity is the per-turn shareDelta; the EV");
  console.log("projection extrapolates it linearly over the remaining pool.");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
