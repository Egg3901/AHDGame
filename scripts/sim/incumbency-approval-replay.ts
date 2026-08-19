/**
 * Incumbency-approval replay harness — READ ONLY.
 *
 * Runs the REAL presidential engine (`accumulatePresidentVoteTurn`) twice over
 * identical live inputs, in dry-run mode so nothing is persisted, and diffs the
 * result:
 *
 *   A (baseline) — incumbency driver fed the stored NATIONAL approval, pivot 46.
 *   B (variant)  — fed this state's OWN government approval, pivot recentred.
 *
 * Why the live race rather than a historical corpus: replaying a resolved
 * election would have to use today's favorability/politicalInfluence, because
 * no per-character stat history is stored anywhere. The active race has no such
 * drift — its inputs ARE the inputs the engine is using right now — so the A/B
 * delta it produces is exact rather than approximate.
 *
 * What it measures:
 *   • the incumbency budget delta per state (closed form, exact)
 *   • the resulting per-state vote-share delta for one turn (engine-measured)
 *   • k = share delta / budget delta, the translation factor that was unknown
 *   • projected electoral college under the variant, over the turns remaining
 *
 * Run: npx tsx scripts/sim/incumbency-approval-replay.ts
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
import { approvalAdjustedIncumbencyBudget } from "@/lib/electionEngine/persuasionDrivers";
import { turnVoteWeight } from "@/lib/electionEngine/voteCalculations";

/** Pivot under test. 46 is production; ~48.5 recentres on the live state mean. */
const VARIANT_PIVOT = Number(process.env.VARIANT_PIVOT ?? 48.5);
const COUNTRY = process.env.COUNTRY ?? "US";

type Row = {
  state: string;
  ev: number;
  approval: number;
  baseShare: number;
  variantShare: number;
  shareDelta: number;
  budgetDelta: number;
  k: number | null;
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

  // Identify the incumbent's candidate id: the sitting president in this race.
  const incumbentChar = await db
    .collection("characters")
    .findOne({ countryId: COUNTRY, "currentOffice.type": "president" });
  const incumbentCandidate = await db
    .collection("electionCandidates")
    .findOne({ electionId: election._id, characterId: incumbentChar?._id });
  const INC = String(incumbentCandidate?._id ?? "");
  if (!INC) throw new Error("could not identify the incumbent's candidacy");

  const approvals = new Map<string, number>();
  await db
    .collection("stateApprovalHistory")
    .find({ countryId: COUNTRY })
    .forEach((r) => {
      approvals.set(String(r._id), r.approvalRating as number);
    });
  const nationalApproval = (
    await db.collection("governmentApprovals").findOne({ _id: COUNTRY as never })
  )?.approvalRating as number;

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
    `INCUMBENCY-APPROVAL REPLAY — ${COUNTRY} president, turn ${currentTurn} → ${nextTurn}`
  );
  console.log(`incumbent: ${names[INC] ?? INC}`);
  console.log(`national approval ${nationalApproval?.toFixed(1)} | variant pivot ${VARIANT_PIVOT}`);
  console.log(`${"=".repeat(78)}\n`);

  const runA = (await accumulatePresidentVoteTurn(election._id as ObjectId, nextTurn, now, {
    dryRun: true,
    incumbentApprovalSource: "national",
  })) as PresidentVoteTurnDryRun;

  const runB = (await accumulatePresidentVoteTurn(election._id as ObjectId, nextTurn, now, {
    dryRun: true,
    incumbentApprovalSource: "state",
    incumbencyApprovalPivot: VARIANT_PIVOT,
  })) as PresidentVoteTurnDryRun;

  const baseBudget = approvalAdjustedIncumbencyBudget(nationalApproval);

  const rows: Row[] = [];
  for (const [state, before] of Object.entries(unitBefore)) {
    const a = runA.totalVotesByUnit[state];
    const b = runB.totalVotesByUnit[state];
    const ap = approvals.get(state);
    if (!a || !b || ap == null) continue;

    // Marginal (this turn only) = cumulative-after minus cumulative-before.
    const marginal = (src: Record<string, number>) => {
      const out: Record<string, number> = {};
      for (const id of runA.candidateIds) out[id] = (src[id] ?? 0) - (before[id] ?? 0);
      return out;
    };
    const mA = marginal(a);
    const mB = marginal(b);

    const baseShare = pct(mA, INC);
    const variantShare = pct(mB, INC);
    const varBudget = approvalAdjustedIncumbencyBudget(ap, VARIANT_PIVOT);
    // Budget units are fractions; ×100 to read as percentage points.
    const budgetDelta = (varBudget - baseBudget) * 100;
    const shareDelta = variantShare - baseShare;

    rows.push({
      state,
      ev: evByState.get(state) ?? 0,
      approval: ap,
      baseShare,
      variantShare,
      shareDelta,
      budgetDelta,
      k: Math.abs(budgetDelta) > 1e-9 ? shareDelta / budgetDelta : null,
    });
  }

  rows.sort((x, y) => x.shareDelta - y.shareDelta);

  console.log("state  EV   appr   budgetΔ   shareΔ      k");
  console.log("-".repeat(50));
  for (const r of rows) {
    console.log(
      `${r.state.padEnd(5)} ${String(r.ev).padStart(3)}  ${r.approval.toFixed(1).padStart(5)}  ` +
        `${r.budgetDelta.toFixed(2).padStart(7)}  ${r.shareDelta.toFixed(3).padStart(7)}  ` +
        `${r.k == null ? "   n/a" : r.k.toFixed(3).padStart(6)}`
    );
  }

  const ks = rows.map((r) => r.k).filter((v): v is number => v != null && Number.isFinite(v));
  ks.sort((a, b) => a - b);
  const kMedian = ks.length ? ks[Math.floor(ks.length / 2)] : NaN;
  const kMean = ks.length ? ks.reduce((s, v) => s + v, 0) / ks.length : NaN;

  console.log("\n" + "=".repeat(78));
  console.log(`MEASURED k  median ${kMedian.toFixed(3)}  mean ${kMean.toFixed(3)}  n=${ks.length}`);
  console.log(
    `share delta  min ${rows[0]?.shareDelta.toFixed(3)}  max ${rows[rows.length - 1]?.shareDelta.toFixed(3)}`
  );

  // Project the final standing. Votes already cast are locked; only the votes
  // still to come carry the variant's share delta. The remaining share of the
  // pool is computed from the production surge curve (`turnVoteWeight`) over
  // the GENERAL window, not guessed — 50% early / 20% ramp / 30% final four.
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

  const turnsLeft = Math.max(0, endTurn - currentTurn);
  let evBase = 0;
  let evVariant = 0;
  const flips: string[] = [];
  for (const r of rows) {
    const before = unitBefore[r.state];
    const cumTotal = Object.values(before).reduce((s, v) => s + v, 0);
    const cumInc = before[INC] ?? 0;
    const cumShare = cumTotal > 0 ? (100 * cumInc) / cumTotal : 0;

    // Blend: locked-in cumulative, plus the remaining pool cast at the
    // variant's marginal share for this unit.
    const projected = cumShare * (1 - remainingFrac) + r.variantShare * remainingFrac;
    const projectedBase = cumShare * (1 - remainingFrac) + r.baseShare * remainingFrac;

    if (projectedBase > 50) evBase += r.ev;
    if (projected > 50) evVariant += r.ev;
    else if (projectedBase > 50) flips.push(r.state);
  }

  console.log(`\nturns remaining: ${turnsLeft}`);
  console.log(
    `pool already cast: ${(castFrac * 100).toFixed(1)}%  still to come: ${(remainingFrac * 100).toFixed(1)}%`
  );
  console.log(`EV  baseline (current standing) : ${evBase}`);
  console.log(`EV  variant  (projected)        : ${evVariant}`);
  console.log(`flips: ${flips.length ? flips.join(", ") : "none"}`);
  console.log("=".repeat(78) + "\n");
  console.log("NOTE: projection is indicative. The engine-measured quantity is k and");
  console.log("the per-turn shareDelta; the EV projection extrapolates those linearly.");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
