/**
 * NPP stance drift (#101) — makes NPPs feel alive by slowly shifting their
 * economic/social stance toward the political lean of the state they represent,
 * gated by how stubborn each NPP is. A stubborn NPP barely moves; a flexible one
 * converges to its state over time.
 *
 * Drift-only by design: it reads each NPP's CURRENT stance and nudges it forward,
 * so existing NPPs grandfather in naturally (no backfill/regeneration). Stance
 * (`policies.economic` / `.social`) and the state lean (`cachedEconomicLean` /
 * `cachedSocialLean`) share the same −5 (left) … +5 (right) axis, so the target
 * needs no rescaling. `domainPositions` are re-derived deterministically
 * (`noise: 0`) so the per-domain stances stay consistent with the drifted axes —
 * which is what the cross-pressure resolver reads for modern bills.
 */
import type { AnyBulkWriteOperation } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { LegislationType, NPP, State } from "@/lib/db/types";
import { deriveDomainPositions } from "@/lib/npp/domainPositions";

/**
 * Max updates per bulkWrite. Sized well under MongoDB's 16MB per-command BSON
 * ceiling: each op embeds a full domainPositions map, and the unchunked write
 * exceeded the limit outright once NPP counts grew.
 */
const STANCE_DRIFT_BULK_CHUNK = 500;

/** Run the drift once every N turns to keep it slow and bound write volume. */
export const NPP_STANCE_DRIFT_INTERVAL = 6;
/** Max stance movement per drift on the −5…+5 axis (before the stubbornness gate). */
export const NPP_STANCE_DRIFT_MAX_STEP = 0.3;

const STANCE_MIN = -5;
const STANCE_MAX = 5;
const STUBBORNNESS_MAX = 100;

/** Per-drift step for an NPP: fully mobile at stubbornness 0, immovable at 100. */
export function nppDriftStep(stubbornness: number): number {
  const mobility = 1 - Math.max(0, Math.min(1, stubbornness / STUBBORNNESS_MAX));
  return NPP_STANCE_DRIFT_MAX_STEP * mobility;
}

/** Nudge one stance axis toward the target by at most `step`, clamped to [−5, 5]. */
export function driftStanceAxis(current: number, target: number, step: number): number {
  const delta = Math.max(-step, Math.min(step, target - current));
  const next = Math.max(STANCE_MIN, Math.min(STANCE_MAX, current + delta));
  return Math.round(next * 10) / 10;
}

/**
 * Turn phase: drift every active NPP's stance toward its home state's lean.
 * No-op except every {@link NPP_STANCE_DRIFT_INTERVAL} turns.
 */
export async function processNppStanceDrift(
  db: Db,
  currentTurn: number
): Promise<{ drifted: number }> {
  if (currentTurn % NPP_STANCE_DRIFT_INTERVAL !== 0) return { drifted: 0 };

  const npps = await db
    .collection<NPP>("npps")
    .find(
      { retiredAt: null },
      { projection: { _id: 1, homeState: 1, policies: 1, personality: 1 } }
    )
    .toArray();
  if (npps.length === 0) return { drifted: 0 };

  const stateIds = [...new Set(npps.map((n) => n.homeState).filter(Boolean))];
  const states = await db
    .collection<State>("states")
    .find(
      { _id: { $in: stateIds } },
      { projection: { _id: 1, cachedEconomicLean: 1, cachedSocialLean: 1 } }
    )
    .toArray();
  const leanByState = new Map(states.map((s) => [String(s._id), s]));
  const legislationTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({})
    .toArray();

  const now = new Date();
  const ops: AnyBulkWriteOperation<NPP>[] = [];
  for (const npp of npps) {
    const lean = leanByState.get(String(npp.homeState));
    if (
      !lean ||
      typeof lean.cachedEconomicLean !== "number" ||
      typeof lean.cachedSocialLean !== "number"
    ) {
      continue;
    }
    const step = nppDriftStep(npp.personality?.stubbornness ?? 50);
    if (step <= 0) continue; // fully stubborn — never moves

    const curEcon = npp.policies?.economic ?? 0;
    const curSocial = npp.policies?.social ?? 0;
    const economic = driftStanceAxis(curEcon, lean.cachedEconomicLean, step);
    const social = driftStanceAxis(curSocial, lean.cachedSocialLean, step);
    if (economic === curEcon && social === curSocial) continue; // already at lean

    // Re-derive domain stances deterministically (noise 0) so they track the
    // drifted axes — the resolver reads these for bills without a policy vector.
    const domainPositions = deriveDomainPositions(
      legislationTypes,
      economic,
      social,
      Math.random,
      0
    );
    ops.push({
      updateOne: {
        filter: { _id: npp._id },
        update: {
          $set: {
            "policies.economic": economic,
            "policies.social": social,
            "policies.domainPositions": domainPositions,
            updatedAt: now,
          },
        },
      },
    });
  }

  // Chunk the write. Each op carries a full `domainPositions` map, so at a few
  // thousand NPPs the single bulkWrite crossed MongoDB's hard 16MB BSON command
  // limit and threw — measured at 16,810,543 bytes against a 16,809,984 ceiling.
  // The phase then failed EVERY turn it exceeded the limit, and because the
  // runtime converts a phase throw into a warning the run reported healthy while
  // no NPP stance drifted at all. This is the recurring nppStanceDrift failure
  // (#3703); it grows with NPP count, so v4 worlds hit it far more often.
  for (let i = 0; i < ops.length; i += STANCE_DRIFT_BULK_CHUNK) {
    await db.collection<NPP>("npps").bulkWrite(ops.slice(i, i + STANCE_DRIFT_BULK_CHUNK));
  }
  return { drifted: ops.length };
}
