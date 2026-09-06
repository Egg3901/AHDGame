import type { ConflictDoc } from "@/lib/db/types/conflict";
import { frontProgress } from "@/lib/military/occupation";

/**
 * War damage to the ground a war is fought over.
 *
 * The gap this closes is the one the postmortem named and a player named first:
 * "Germans + Soviets got 0 wartime penalties, though, and somehow perfectly paved
 * the roads that they bombed." A 1.24 million casualty war produced no economic
 * consequence of any kind, because `src/lib/economy` had no consumer of conflict
 * state at all.
 *
 * DELIBERATELY SCOPED TO THE HOST. An expeditionary belligerent is not wrecked by
 * fighting abroad; it pays in money and men, which the defence appropriation and
 * `computeWarApproval` already model. What ruins a country is a war fought ON IT.
 * That is also the exact case the complaint was about: Germany and the DDR were
 * the ground, and their roads were untouched.
 *
 * The route to the economy is the one the engine already owns, not a new one:
 * `infrastructure.roadCondition` feeds `infrastructure.transportEfficiency`, which
 * is a TFP basket input, which sets potential growth, which sets GDP. Nothing here
 * writes to `sectorGrowth` or `gdpGrowth` — an authored rate shock belongs on the
 * crisis path (see `resolveCrisisMetricPath`), and a standing wartime condition is
 * not a shock, it is a condition.
 */
export interface WarDamage {
  /**
   * How far the front has moved from its start line, 0..1, worst across every live
   * war on this country's soil. Ground changing hands is the observable proxy for a
   * war being fought across a country rather than sitting on its border.
   */
  frontProgress: number;
}

/**
 * Road condition the fighting takes off the funding-supported floor, at a fully
 * mobile front.
 *
 * `roadCondition`'s supported band is 35..95 (`supportedLevel(ctx, 35, 60)`), so 25
 * points is most of the distance a funded country stands above the floor. A nation
 * whose territory is being fought across cannot buy its way to good roads, which is
 * the point; a nation at peace is untouched by this term entirely.
 */
export const WAR_ROAD_TARGET_PENALTY = 25;

/**
 * Extra erosion at a fully mobile front, in the same units as `roadCondition`'s own
 * 0.06 decay and scaled by the caller the same way.
 *
 * Maintenance decay alone is far too gentle to model bombing: at 0.06 the stock would
 * need hundreds of turns to reach even a reduced floor, and the War for Germany ran
 * 130.
 *
 * MEASURED, because the arithmetic here is not obvious. `maintenanceDecay` erodes the
 * BASELINE and the stored value chases it, so a sustained decline settles at the
 * baseline's rate rather than at `(1 - inertia)` of it. The `/(1 - inertia)` scaling
 * this file inherits from `capitalCompute` is calibrated for a single step, so a
 * sustained war term of 0.2 erodes the value at about 1.3 a turn, not 0.2.
 *
 * The resulting behaviour, from `scripts/sim/warRoadDamage.ts` driving the real node
 * over 130 turns from a well-funded 78:
 *
 *   front moved  25%:  60.7 at peace ->  54.5   (-6.3)
 *   front moved  50%:  60.7 at peace ->  48.2   (-12.5)
 *   front moved 100%:  60.7 at peace ->  35.7   (-25.0, floored by about turn 50)
 *
 * So a contested war is a nagging drag and a war that sweeps the whole country wrecks
 * it inside about fifty turns. That is the intended shape: the 100% case means the
 * enemy has taken all of your territory, and roads at the bottom of the band is the
 * right answer to that. Recovery is real but not instant: about fifty turns of funded
 * peace to return to the supported level.
 */
export const WAR_ROAD_EXTRA_DECAY = 0.2;

/** No war on this country's soil, and so no damage. The overwhelmingly common case. */
export const NO_WAR_DAMAGE: WarDamage = { frontProgress: 0 };

/** How much of the funded road target the fighting removes. 0 when at peace. */
export function warRoadTargetPenalty(damage: WarDamage | undefined): number {
  const p = damage?.frontProgress ?? 0;
  if (!Number.isFinite(p) || p <= 0) return 0;
  return WAR_ROAD_TARGET_PENALTY * Math.min(1, p);
}

/**
 * Extra per-turn erosion from the fighting, expressed on the node's VALUE.
 *
 * The caller scales this by `1 / (1 - inertia)` exactly as it does the ordinary
 * decay, because the EMA damps a baseline step by `(1 - inertia)`.
 */
export function warRoadExtraDecay(damage: WarDamage | undefined): number {
  const p = damage?.frontProgress ?? 0;
  if (!Number.isFinite(p) || p <= 0) return 0;
  return WAR_ROAD_EXTRA_DECAY * Math.min(1, p);
}

type DamageConflict = Pick<
  ConflictDoc,
  "status" | "hostCountry" | "hostEntities" | "control" | "controlStart"
>;

/**
 * War damage per country, from the live conflicts.
 *
 * Keyed on `hostEntities` and falling back to `hostCountry`, because a war widened to
 * cover a second country is fought on that country's soil too — the War for Germany
 * carries both Germanies as hosts and only one of them is the map anchor. This is the
 * same rule `loadCountryWarNotice` applies for the wartime banner.
 *
 * A resolved war does no damage: the roads start recovering the turn the fighting stops.
 */
export function warDamageByCountry(conflicts: DamageConflict[]): Map<string, WarDamage> {
  const out = new Map<string, WarDamage>();
  for (const c of conflicts) {
    if (c.status === "resolved") continue;
    const control = c.control;
    if (!Number.isFinite(control)) continue;
    const progress = frontProgress(control, c.controlStart ?? 50);
    if (!Number.isFinite(progress) || progress <= 0) continue;
    const hosts = c.hostEntities?.length ? c.hostEntities : c.hostCountry ? [c.hostCountry] : [];
    for (const host of hosts) {
      const prev = out.get(host)?.frontProgress ?? 0;
      // Worst front across every war on this soil: two wars do not heal each other.
      if (progress > prev) out.set(host, { frontProgress: Math.min(1, progress) });
    }
  }
  return out;
}
