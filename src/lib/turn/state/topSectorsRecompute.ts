/**
 * Per-turn recompute of `State.topSectorsCache` — the top-3 corporate
 * sectors by aggregate per-turn revenue for each state.
 *
 * Reads `corporateSectors` (state-scoped, see schema in `db/types/corporation.ts`),
 * groups by `(stateId, sectorType)`, sums `revenue`, sorts descending,
 * and writes the top `TOP_N` per state into `states.topSectorsCache`.
 *
 * Each cache entry is tagged with `specializationBonus`:
 *   - `"primary"` when the sector matches `State.sectorSpecializations.primary`
 *     (+10pp regional margin bonus the state grants this sector)
 *   - `"secondary"` when it matches `.secondary` (+5pp)
 *   - `null` otherwise
 *
 * Called from `stateEffectsAndNationalAggregation` in
 * `turnPhaseRegistry.ts` so the State Overview tab's Economy card has
 * fresh data on every page load without paying an aggregation cost
 * on each request.
 *
 * Empty / no-activity states get an empty `sectors` array; the
 * Overview falls back to `sectorSpecializations.{primary, secondary}`
 * for display when the cache is empty.
 */

import type { Db } from "mongodb";
import type { CorporationType } from "@/lib/constants/corporations";
import type { State } from "@/lib/db/types";

/** How many top sectors to surface per state. */
const TOP_N = 3;

export interface TopSectorsRecomputeResult {
  statesProcessed: number;
  /** Number of state docs that received a non-empty top-sectors snapshot. */
  statesWithActivity: number;
}

interface AggRow {
  _id: { stateId: string; sectorType: CorporationType };
  revenue: number;
}

export async function processTopSectorsRecompute(
  db: Db,
  currentTurn: number,
  now: Date = new Date()
): Promise<TopSectorsRecomputeResult> {
  // Single aggregation that groups every sector instance by (state, type).
  // `revenue` is the per-turn revenue stored on each `corporateSectors` row.
  const rows = await db
    .collection("corporateSectors")
    .aggregate<AggRow>([
      {
        $group: {
          _id: { stateId: "$stateId", sectorType: "$sectorType" },
          revenue: { $sum: "$revenue" },
        },
      },
      { $sort: { revenue: -1 } },
    ])
    .toArray();

  // Group by stateId in memory (already sorted desc by revenue, so the first
  // N entries per state are the top N).
  const byState = new Map<string, Array<{ sectorType: CorporationType; revenue: number }>>();
  for (const row of rows) {
    const list = byState.get(row._id.stateId) ?? [];
    if (list.length < TOP_N) {
      list.push({ sectorType: row._id.sectorType, revenue: row.revenue });
      byState.set(row._id.stateId, list);
    } else if (!byState.has(row._id.stateId)) {
      byState.set(row._id.stateId, list);
    }
  }

  // Tag each entry with its specialization bonus (if any) and write to
  // every state that has at least one active sector. States without
  // activity keep their existing cache (or no cache) — the Overview
  // fallback handles those.
  const states = await db
    .collection<State>("states")
    .find({}, { projection: { _id: 1, sectorSpecializations: 1 } })
    .toArray();

  const result: TopSectorsRecomputeResult = {
    statesProcessed: states.length,
    statesWithActivity: 0,
  };

  const ops: Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: Partial<State> };
    };
  }> = [];

  for (const state of states) {
    const live = byState.get(state._id) ?? [];
    const spec = state.sectorSpecializations;
    const sectors = live.map((s) => ({
      sectorType: s.sectorType,
      revenue: s.revenue,
      specializationBonus:
        spec?.primary === s.sectorType
          ? ("primary" as const)
          : spec?.secondary === s.sectorType
            ? ("secondary" as const)
            : null,
    }));
    if (sectors.length > 0) result.statesWithActivity += 1;
    ops.push({
      updateOne: {
        filter: { _id: state._id },
        update: {
          $set: {
            topSectorsCache: {
              sectors,
              computedAtTurn: currentTurn,
              computedAt: now,
            },
          },
        },
      },
    });
  }

  if (ops.length > 0) {
    await db.collection<State>("states").bulkWrite(ops, { ordered: false });
  }

  return result;
}
