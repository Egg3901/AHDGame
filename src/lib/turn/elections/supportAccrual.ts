/**
 * Per-turn Support accrual tick + rally accrual queue helpers.
 *
 * Implements B1 from `2026-05-22-swing-flow-driver-activation.md`. A
 * rally event delivers 60% of its full value immediately and queues the
 * remaining 40% as a trailing drip spread across `RALLY_SPREAD_TURNS`
 * turns. The per-turn processor below applies the drip + decrements
 * `turnsRemaining` for each queued entry, pruning entries whose tail
 * has fully paid out.
 *
 * Lifecycle invariants:
 *   - Each entry: `{ amountPerTurn: number, turnsRemaining: number }`.
 *   - Per turn: each entry contributes `amountPerTurn` to candidate
 *     Support, then `turnsRemaining` decrements by 1.
 *   - Entries with `turnsRemaining <= 0` after the decrement are pruned.
 *   - Support is clamped to [0, 100] after every accrual contribution.
 */

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Election, ElectionCandidate } from "@/lib/db/types";
import {
  RALLY_IMMEDIATE_SHARE,
  RALLY_SPREAD_TURNS,
} from "@/lib/electionEngine/electionFormulaFactors";

export interface SupportAccrualTickResult {
  candidatesUpdated: number;
}

/**
 * Pure helper: compute the new `supportAccrual` list and the total
 * Support delta to apply from one tick of accruals. Exported for unit
 * testing without a database.
 *
 * Each entry contributes `amountPerTurn` to the delta this turn; its
 * `turnsRemaining` then decrements by 1. Entries with `turnsRemaining`
 * already at zero are pruned without contributing (defensive).
 */
export function tickSupportAccrual(
  accrual: Array<{ amountPerTurn: number; turnsRemaining: number }> | undefined
): { newAccrual: Array<{ amountPerTurn: number; turnsRemaining: number }>; delta: number } {
  if (!accrual || accrual.length === 0) {
    return { newAccrual: [], delta: 0 };
  }
  let delta = 0;
  const newAccrual: Array<{ amountPerTurn: number; turnsRemaining: number }> = [];
  for (const entry of accrual) {
    if (!Number.isFinite(entry.amountPerTurn) || !Number.isFinite(entry.turnsRemaining)) continue;
    if (entry.turnsRemaining <= 0) continue;
    delta += entry.amountPerTurn;
    const nextRemaining = entry.turnsRemaining - 1;
    if (nextRemaining > 0) {
      newAccrual.push({ amountPerTurn: entry.amountPerTurn, turnsRemaining: nextRemaining });
    }
  }
  return { newAccrual, delta };
}

/**
 * Pure helper: build one rally accrual entry from a full-value `R`
 * (already race-family-scaled by the caller). Returns the immediate
 * Support bump that should be applied to `support` synchronously AND
 * the accrual entry to push into `supportAccrual`.
 */
export function buildRallyAccrualEntry(R: number): {
  immediateBump: number;
  entry: { amountPerTurn: number; turnsRemaining: number };
} {
  if (!Number.isFinite(R) || R <= 0) {
    return { immediateBump: 0, entry: { amountPerTurn: 0, turnsRemaining: 0 } };
  }
  const immediateBump = R * RALLY_IMMEDIATE_SHARE;
  const trailingTotal = R - immediateBump;
  const amountPerTurn = trailingTotal / RALLY_SPREAD_TURNS;
  return {
    immediateBump,
    entry: { amountPerTurn, turnsRemaining: RALLY_SPREAD_TURNS },
  };
}

/**
 * Per-turn sweep that applies queued Support drips to every active
 * candidate with a non-empty `supportAccrual`. Runs alongside
 * `supportDecay` in the politics turn-phase block. Idempotent — entries
 * are pruned as they fully pay out, so a steady-state candidate with
 * no active rally tour eventually empties their accrual list.
 *
 * Clamps Support to [0, 100] after applying the delta. The decay
 * processor handles regression-to-50 independently.
 */
export async function processSupportAccrualTick(
  _turn: number,
  _now: Date,
  injectedDb?: Db
): Promise<SupportAccrualTickResult> {
  const db = injectedDb ?? (await getDb());

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
      supportAccrual: { $exists: true, $ne: [] },
    })
    .toArray();
  if (candidates.length === 0) return { candidatesUpdated: 0 };

  // Batched — same sequential-round-trip pattern already found and fixed in
  // indexFunds (108s+ turns at ~10,700 NPPs) and supportDecay above.
  // Naturally sparser than supportDecay's scan (only candidates with an
  // active rally-tour drip queued), but still scales with country × NPP
  // density toward a 30-50-country sim.
  const ops: { updateOne: { filter: { _id: ElectionCandidate["_id"] }; update: object } }[] = [];
  for (const c of candidates) {
    if (c.campaignSuspended) continue;

    const { newAccrual, delta } = tickSupportAccrual(c.supportAccrual);
    if (delta === 0 && newAccrual.length === c.supportAccrual?.length) continue;
    const currentSupport = typeof c.support === "number" ? c.support : 50;
    const nextSupport = Math.max(0, Math.min(100, currentSupport + delta));
    const update: {
      $set: { support: number; supportAccrual?: typeof newAccrual };
      $unset?: { supportAccrual: "" };
    } = {
      $set: { support: nextSupport },
    };
    if (newAccrual.length > 0) {
      update.$set.supportAccrual = newAccrual;
    } else {
      update.$unset = { supportAccrual: "" };
    }
    ops.push({ updateOne: { filter: { _id: c._id }, update } });
  }
  if (ops.length === 0) return { candidatesUpdated: 0 };

  await db.collection<ElectionCandidate>("electionCandidates").bulkWrite(ops);

  return { candidatesUpdated: ops.length };
}
