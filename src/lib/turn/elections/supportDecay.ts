/**
 * Support decay turn-phase processor.
 *
 * For every active election candidate, Support regresses toward the
 * neutral midpoint (`DEFAULT_CANDIDATE_SUPPORT = 50`) by
 * `SUPPORT_DECAY_PER_TURN` per turn. This implements the design doc §3.1
 * lifecycle item:
 *
 *   "decays per turn while `Election.status === "active"` (rate
 *    calibrated in Phase 4 — see §8 step 5)"
 *
 * Candidates whose election has resolved or who have themselves withdrawn
 * are skipped — withdrawal does NOT clear the field (per §3.1 contract);
 * resolution does, and that's the responsibility of `clearSupportOnResolve`.
 *
 * Pure DB scan; runs in the politics phase block alongside the other
 * Reg/Org decay processors.
 */

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Election, ElectionCandidate } from "@/lib/db/types";
import {
  DEFAULT_CANDIDATE_SUPPORT,
  SUPPORT_DECAY_PER_TURN,
} from "@/lib/electionEngine/electionFormulaFactors";

export interface SupportDecayResult {
  candidatesUpdated: number;
}

/**
 * Apply one turn's worth of mean-regression decay toward
 * `DEFAULT_CANDIDATE_SUPPORT` to every active candidate of every active
 * election. Returns how many rows were touched (i.e. moved by ≥ 0.01).
 */
export async function processSupportDecay(
  _turn: number,
  _now: Date,
  injectedDb?: Db
): Promise<SupportDecayResult> {
  const db = injectedDb ?? (await getDb());

  // Pull active elections — only their candidates decay. `status` widens
  // to string in the type union; the literal "active" is what tally /
  // resolution code uses elsewhere.
  const activeElections = await db
    .collection<Election>("elections")
    .find({ status: "active" }, { projection: { _id: 1 } })
    .toArray();
  if (activeElections.length === 0) return { candidatesUpdated: 0 };

  const electionIds = activeElections.map((e) => e._id);
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      electionId: { $in: electionIds },
      status: "active",
      support: { $exists: true },
    })
    .toArray();
  if (candidates.length === 0) return { candidatesUpdated: 0 };

  // Batched: this used to be a sequential updateOne per candidate — fine at
  // 8-country scale, but the exact sequential-round-trip pattern that made
  // the indexFunds turn phase take 108s+ at ~10,700 NPPs (found and fixed
  // earlier this session). Candidate count scales with country × NPP
  // density, so toward a 30-50-country sim this needed the same bulkWrite
  // batching.
  const ops: { updateOne: { filter: { _id: ElectionCandidate["_id"] }; update: object } }[] = [];
  for (const c of candidates) {
    const current = c.support;
    if (current == null || !Number.isFinite(current)) continue;
    const next = regressToward(current, DEFAULT_CANDIDATE_SUPPORT, SUPPORT_DECAY_PER_TURN);
    if (Math.abs(next - current) < 0.001) continue;
    ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { support: next } } } });
  }
  if (ops.length === 0) return { candidatesUpdated: 0 };

  await db.collection<ElectionCandidate>("electionCandidates").bulkWrite(ops);

  return { candidatesUpdated: ops.length };
}

/**
 * Move `value` toward `target` by `step` units, never overshooting. Pure
 * helper — exported for tests. Linear regression-to-mean: a candidate
 * 10 units above the midpoint loses `step`, a candidate 10 units below
 * gains `step`, a candidate within `step` of the midpoint snaps to it.
 */
export function regressToward(value: number, target: number, step: number): number {
  const delta = target - value;
  if (Math.abs(delta) <= step) return target;
  return value + Math.sign(delta) * step;
}

export interface ClearResolvedSupportResult {
  candidatesCleared: number;
}

/**
 * Sweep that `$unset`s `support` on every candidate row whose election
 * has reached `"resolved"` status and that still has a Support value.
 *
 * Implements the §3.1 lifecycle item:
 *
 *   "cleared at `Election.status === "resolved"` (set to undefined;
 *    applies to both primaries and direct generals)"
 *
 * Idempotent — once an election's candidates are cleared, the projection
 * filter excludes them on subsequent runs.
 */
export async function processClearResolvedSupport(
  injectedDb?: Db
): Promise<ClearResolvedSupportResult> {
  const db = injectedDb ?? (await getDb());

  const resolvedElections = await db
    .collection<Election>("elections")
    .find({ status: "resolved" }, { projection: { _id: 1 } })
    .toArray();
  if (resolvedElections.length === 0) return { candidatesCleared: 0 };

  const resolvedElectionIds = resolvedElections.map((e) => e._id);
  const result = await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { electionId: { $in: resolvedElectionIds }, support: { $exists: true } },
      { $unset: { support: "" } }
    );

  return { candidatesCleared: result.modifiedCount ?? 0 };
}
