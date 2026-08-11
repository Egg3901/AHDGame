import type { Db } from "mongodb";
import type { MilitaryUnit, Posture } from "@/lib/db/types/militaryUnit";
import type { CountryId } from "@/lib/constants/countries";
import {
  FORCE_EFFECT,
  aggregateForce,
  DEFENSE_POSITION_BY_COUNTRY,
  type ForceAggregate,
} from "@/lib/constants/military";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { getCabinetSettingsCollection } from "@/lib/db/collections/cabinetSettings";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { resolveDefenseLine } from "./defenseEnvelope";
import { accrualPerTurn, upkeepPerTurn, upkeepBurden } from "@/lib/military/appropriation";
import { seedRosterUpkeepFor } from "@/lib/military/seedRosterUpkeep";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";
import { forceDefenseContribution } from "@/lib/politicalMetrics/forceDefense";

// The baselines and the step live in a leaf module: the conflict record projects
// this same rule at the player, and must read the numbers rather than restate them.
import { readinessBaselineOf, READINESS_DRIFT_STEP } from "@/lib/military/readinessDrift";

/**
 * Pure: force aggregate + upkeep burden → Defense metric deltas. All deltas are applied
 * downstream through the existing capped cabinet-effect mechanism.
 *
 * `burden` is the force measured against the country's own SEEDED order of battle (see
 * `upkeepBurden` — the defence line cancels out of it, so this does not track budget
 * choices).
 * It replaced a synthetic envelope that was floored at a country-independent constant — on
 * the live board 26 of 27 nations sat exactly on that floor, so `budgetBalance` contained no
 * budget term at all and moved only with roster size. Russia, whose defence line is sized for
 * its 49 units, read the WORST balance on the board for having a large army.
 *
 * ⚠️ `burden` is nullable ON PURPOSE and null is NOT interchangeable with 0. A burden of 0
 * means the force costs nothing to sustain, which is the most POSITIVE reading available;
 * null means the country has no usable defence line and the metric has nothing to say.
 * Collapsing the two — by narrowing this to `number` and letting callers pass 0 — hands every
 * unfunded country a maximal score. `militaryForceEffects.test.ts` pins the difference.
 */
export function computeForceMetricDeltas(
  agg: ForceAggregate,
  burden: number | null
): {
  publicSafetyConfidence: number;
  budgetBalance: number;
  publicTrust: number;
  socialCohesion: number;
} {
  const power = (agg.totalPower / FORCE_EFFECT.POWER_NORM) * FORCE_EFFECT.powerWeight;
  const ready = (agg.avgReadiness - FORCE_EFFECT.readinessBaseline) * FORCE_EFFECT.readinessWeight;
  // A force at its country's seeded size burns 0.55 of the line and reads +0.45; it takes
  // ~1.82x the seeded roster to reach zero and 3.64x to bottom out.
  const gap = burden == null ? 0 : Math.max(-1, Math.min(1, 1 - burden));
  return {
    publicSafetyConfidence: +(power + ready).toFixed(4),
    budgetBalance: +(gap * FORCE_EFFECT.budgetWeight).toFixed(4),
    publicTrust: +(agg.forwardShare * FORCE_EFFECT.forwardTrust).toFixed(4),
    socialCohesion: +(agg.forwardShare * FORCE_EFFECT.forwardCohesion).toFixed(4),
  };
}

/** Move a unit's readiness one bounded step toward its posture baseline. */
export function driftReadiness(current: number, posture: Posture, arrearsRatio = 0): number {
  const target = readinessBaselineOf(posture, arrearsRatio);
  if (current < target) return Math.min(target, current + READINESS_DRIFT_STEP);
  if (current > target) return Math.max(target, current - READINESS_DRIFT_STEP);
  return current;
}

/**
 * Turn step: compute the country's Defense force aggregates and merge metric deltas
 * into the shared per-country effects bucket (applied downstream through the
 * existing capped mechanism). No-op for countries without a defense seat or with zero
 * units. Read-only on the federal budget.
 *
 * Readiness drift is NOT here — see `applyReadinessDrift`, which the appropriation sweep
 * runs for every country rather than only the seated ones.
 */
export async function applyMilitaryForceEffects(
  db: Db,
  countryId: string,
  bucket: { national: Record<string, number>; politicalDirect?: Record<string, number> },
  /**
   * Seed preset, for the roster the upkeep burden is denominated against. REQUIRED, not
   * defaulted: the wrong preset silently measures the force against another era's order of
   * battle, which quietly mis-states every Defense metric rather than failing.
   */
  preset: string
): Promise<void> {
  const positionId = DEFENSE_POSITION_BY_COUNTRY[countryId as CountryId];
  if (!positionId) return;
  const mechanics = getCabinetMechanics(countryId, positionId);
  if (!mechanics) return;

  const units = await getMilitaryUnitsCollection(db)
    .find({ countryId: countryId as CountryId })
    .toArray();
  if (units.length === 0) return;

  const setting = await getCabinetSettingsCollection(db).findOne({
    _id: `${countryId}_${positionId}`,
  });
  const tier = setting?.tierSetting ?? "standard";

  const agg = aggregateForce(units, countryId, tier);
  // Real money, both sides: what this country's force costs per turn against what its
  // enacted defence line brings in. Computed here rather than read off the pot because the
  // pot stores the settled arrears, not the burden that produced it.
  const line = await resolveDefenseLine(db, countryId);
  const seedRoster = seedRosterUpkeepFor(preset, countryId);
  // ⚠️ The seed roster is checked HERE, not left to `upkeepPerTurn`. That function returns 0
  // for an unmeasurable seed, and a 0 upkeep against a real accrual is a burden of 0 — the
  // MAXIMAL budget balance. A country whose order of battle cannot be measured (a new nation
  // added to the defence map before it has a seeded OOB) would silently be scored as running
  // a free army rather than contributing no signal.
  const burden =
    seedRoster > 0
      ? upkeepBurden(upkeepPerTurn(agg.totalUpkeep, seedRoster, line), accrualPerTurn(line))
      : null;
  const deltas = computeForceMetricDeltas(agg, burden);

  const metrics = [...mechanics.nationalMetrics, ...mechanics.regionalMetrics];
  const add = (metric: string, v: number) => {
    if (!v) return;
    const path = resolveMetricPath(metric, metrics);
    bucket.national[path] = (bucket.national[path] ?? 0) + v;
  };
  add("publicSafety.publicSafetyConfidence", deltas.publicSafetyConfidence);
  add("governance.budgetBalance", deltas.budgetBalance);
  add("governance.publicTrust", deltas.publicTrust);
  add("social.socialCohesion", deltas.socialCohesion);

  // Political-pipeline countries: the force also drives the hard-power `defense`
  // political families directly (the residual channel maps no StateMetrics key to
  // them). Stashed on the bucket; the ministerial producer merges it into the
  // political contribution snapshot.
  if (isPoliticalApprovalCountry(countryId)) {
    const avgTechTier = units.reduce((s, u) => s + u.techTier, 0) / units.length;
    bucket.politicalDirect = forceDefenseContribution(agg, burden, avgTechTier);
  }
}

/**
 * Settle every unit's readiness toward its posture baseline, suppressed by unpaid upkeep.
 *
 * Lives OUTSIDE `applyMilitaryForceEffects` deliberately. That step returns early without a
 * defence seat, but the appropriation sweep charges every country with units — so leaving the
 * drift there let the eleven seatless nations that field real forces (FR, IT, ES, SE, TR, BR,
 * GR, FI, AT and the two devolved UK members) accrue arrears that nothing ever collected on.
 * Their armies could run permanently unfunded at full readiness.
 *
 * Called by the appropriation sweep with the ratio it just computed, which also means the
 * "drift must see this turn's arrears" constraint is satisfied structurally rather than by
 * keeping two turn steps adjacent in the pipeline.
 *
 * `units` is passed in because the caller has just read them; re-reading here would double
 * the sweep's query count for no benefit.
 */
export async function applyReadinessDrift(
  db: Db,
  units: MilitaryUnit[],
  arrearsRatio: number
): Promise<void> {
  const ops = units
    .map((u) => ({ u, next: driftReadiness(u.readiness, u.posture, arrearsRatio) }))
    .filter(({ u, next }) => next !== u.readiness)
    .map(({ u, next }) => ({
      updateOne: { filter: { _id: u._id }, update: { $set: { readiness: next } } },
    }));
  if (ops.length) await getMilitaryUnitsCollection(db).bulkWrite(ops);
}
