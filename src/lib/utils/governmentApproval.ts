/**
 * Government Approval Calculation
 *
 * Base: 50%. Each metric (vs national average) contributes:
 * - Above average (for "higher is better") or below average (for "lower is better") → positive
 * - Opposite → negative
 *
 * State approval: computed from state metrics vs national averages
 * National approval: population-weighted average of all state approvals
 */

import type { AnyBulkWriteOperation, Db } from "mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { StateMetrics, MetricCategoryId, State } from "@/lib/db/types";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import type { StateApprovalHistory } from "@/lib/db/types/stateApproval";
import { type CountryId } from "@/lib/constants/countries";
import { actingAppointmentsEnabled } from "@/lib/cabinet/actingEligibility";
import {
  evaluateModifiers,
  applyModifiers,
  type ActiveModifier,
} from "@/lib/utils/approvalModifiers";
import { getEraContext } from "@/lib/era/context";
import { isMetricActive } from "@/lib/era/metricCatalog";
import { getActiveNationalAddressModifier } from "@/lib/governorOffice/address/activeAddressModifiers";
import { getActiveOrgStatementModifiersByCountry } from "@/lib/internationalOrganizations/jointStatement";
import { getActiveFairnessGapModifiers } from "@/lib/redistricting/fairnessApproval";
import { computeWarApproval } from "@/lib/military/warApproval";
import { IS_HIGHER_BETTER } from "@/lib/utils/metricScoring";
import { axisAffinityFor, type AxisAffinity } from "@/lib/utils/metricAxisAffinity";
import type { StateDemographicGroup, StateDemographics } from "@/lib/db/types/demographics";
// SP4: hybrid political approval for LAW_COUNTRY_IDS. Function-time-only cycle
// with this module (the provider imports BASE_APPROVAL) — safe by hoisting.
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";

const NO_CABINET_PENALTY = 7.5;
const ACTING_APPOINTMENT_PENALTY = 0.5;

const CATEGORIES: MetricCategoryId[] = [
  "economic",
  "education",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "environment",
  "social",
  "governance",
  "population",
  "mediaInformation",
];

// Per-metric "higher is better" direction comes from the metricDefinitions
// SSOT (via metricScoring), imported above and re-exported here. A second
// hand-map in this file silently omitted the P2–P6 lower-better metrics and
// scored them inverted in approval (childPoverty, NHS waits, knife crime,
// debt, housing pressure). Deriving from the definitions makes omission
// impossible. (P6d-pre consolidation.)
export { IS_HIGHER_BETTER };

/**
 * Derived demographic readouts that must NOT contribute a monotonic approval
 * term (design §4.3.1 / §4.7 scoring-channel). They are still surfaced metrics
 * (their UI quality badge in `metricScoring.THRESHOLDS` is unaffected) — only the
 * approval contribution is skipped, because each is an engine-derived stock whose
 * real consequences already reach approval through the economic metrics:
 *   - `sexRatio` — target-band readout; teeth are emergent (socialCohesion).
 *   - `dependencyRatio` — structural readout (aging → fiscal drag via economy).
 *   - `populationGrowth` — pure cohort-flow output; a direct term double-counts
 *     the migration/fertility effect already priced into the economic metrics.
 *   - `medianAge` — pure cohort-flow output; excluding it also NEUTRALIZES the
 *     secular-aging approval drift (every country would otherwise slowly lose
 *     approval purely from the intended aging dynamic). (§4.7 audit-P2.)
 * `migrationRate` is deliberately NOT excluded — it is a policy lever players
 * push (the intended coexistence wedge, like the economic metrics), so it keeps
 * a direct approval term.
 */
export const APPROVAL_EXCLUDED_METRICS = new Set([
  "sexRatio",
  "dependencyRatio",
  "populationGrowth",
  "medianAge",
  // Realized-flow diagnostic readout (§8.2) — surfaced for UI comparison against
  // the policy migrationRate input, not an approval term.
  "realizedMigrationRate",
  // Surfaced supply-side trend (P1c-1) — redundant with the gdpGrowth it drives;
  // `laborForce` is a raw headcount. Neither is an approval term.
  "potentialGrowth",
  "laborForce",
  // Cyclical sector signal (P1c-2) — an intermediate; the integrated gdpGrowth
  // carries the approval term.
  "sectorGrowth",
  // Dynamic fiscal-growth factors — engine intermediates that compound the tax
  // base; gdpGrowth + medianIncome already carry the economic-performance signal
  // into approval, so scoring these too would double-count.
  "wageGrowth",
  "tradeGrowth",
  // Per-state confidence drivers — they feed sector margins (consumer) and HQ
  // corp valuation (investor), not approval; gdpGrowth/unemployment already carry
  // the economic-performance signal into approval, so scoring these double-counts.
  "consumerConfidence",
  "investorConfidence",
  // NOTE: the six P6a axis metrics (civilLiberties, nationalPride,
  // militaryReadiness, stateMediaControl, economicFreedom, regulatoryBurden)
  // were excluded at birth and are now UN-EXCLUDED at the P6d cutover — they
  // score approval as electorate-weighted terms (each carries an axis affinity
  // so it lands on the voters who care). See metricAxisAffinity.ts.
]);

const ERA_ANACHRONISTIC_METRICS_PRE2000 = new Set([
  "broadbandAccess",
  "renewableEnergy",
  "energyTransitionProgress",
  "recyclingRate",
  "carbonEmissions",
]);

const PRE2000_PRESETS = new Set(["1953-default", "1979-default", "1991-default", "1999-default"]);

export function getApprovalExcludedMetrics(preset: string, year?: number | null): Set<string> {
  // Flag ON (year set): the era catalog's existence windows are the SSOT for
  // anachronism — isMetricActive gates each term per country/year — so the
  // preset-keyed exclusion set is superseded. Deliberate flips owned by the
  // dry-run: renewableEnergy/recyclingRate become ACTIVE in 1979/1991 worlds
  // (windows 1974/1972), carbonEmissions in 1991 worlds (window 1990).
  if (year != null && Number.isFinite(year)) return APPROVAL_EXCLUDED_METRICS;
  if (PRE2000_PRESETS.has(preset)) {
    return new Set([...APPROVAL_EXCLUDED_METRICS, ...ERA_ANACHRONISTIC_METRICS_PRE2000]);
  }
  return APPROVAL_EXCLUDED_METRICS;
}

/** Contribution per metric: max ±2. Scale factor for pct deviation. */
const CONTRIBUTION_SCALE = 15;
const MAX_CONTRIBUTION = 2;
/** Default approval when metrics are missing (used for elections and display). */
export const BASE_APPROVAL = 50;

/**
 * P6d — strength of electorate ideology weighting. Each demographic group
 * weights a metric by `1 + k·(econLeanNorm·econAff + socialLeanNorm·socialAff)`
 * (leans normalized to [−1,1]). k=0 reproduces the ideology-blind average
 * exactly. At k=1 a maximally-aligned group double-weights a metric (×2) and a
 * maximally-opposed group ignores it (floored at 0) — a strong, interpretable
 * range that, on a polarized state, opens a ~4pt conservative-vs-progressive
 * approval gap while keeping the shift-vs-baseline within the ±5pt live bound
 * (GATE 2). Phase C: bumped from 1.0 → 1.3 to give polarized electorates more
 * signal separation without breaking the live-shift bound.
 */
export const APPROVAL_AXIS_WEIGHT_K = 1.3;

/**
 * Population-weighted mean over demographic groups of each group's affinity
 * weight for one metric. Returns 1 (neutral) when k=0, there are no groups, or
 * total population is zero — so the weighting is an identity in the degenerate
 * cases (the k=0 golden master). Per-group weights are floored at 0 so an
 * extreme group can zero-out a metric it is hostile to but never invert it.
 */
export function effectiveMetricWeight(
  affinity: AxisAffinity,
  groups: StateDemographicGroup[],
  k: number
): number {
  if (k === 0 || groups.length === 0) return 1;
  if (affinity.econ === 0 && affinity.social === 0) return 1; // universal good
  let popSum = 0;
  let weighted = 0;
  for (const g of groups) {
    const pop = g.population ?? 0;
    if (pop <= 0) continue;
    const w = Math.max(
      0,
      1 + k * ((g.economicLean / 5) * affinity.econ + (g.socialLean / 5) * affinity.social)
    );
    weighted += pop * w;
    popSum += pop;
  }
  return popSum > 0 ? weighted / popSum : 1;
}

/**
 * P6d — load each state's demographic groups for electorate-weighted approval,
 * keyed by `${countryId}:${stateId}` so a cross-country state-ID collision
 * (CN HB / DE HB) never returns the wrong electorate. Pass a Mongo filter to
 * scope the read (e.g. `{ countryId }` or `{ _id: { $in: stateIds }, countryId }`).
 */
export async function loadElectorateGroups(
  db: Db,
  filter: Record<string, unknown> = {}
): Promise<Map<string, StateDemographicGroup[]>> {
  const docs = await db
    .collection<StateDemographics>("stateDemographics")
    .find(filter, { projection: { _id: 1, countryId: 1, groups: 1 } })
    .toArray();
  return new Map(docs.map((d) => [`${d.countryId}:${d._id}`, Object.values(d.groups ?? {})]));
}

/** Build the optional `weighting` arg for a state from a composite-keyed group map. */
export function weightingFor(
  groupsByState: Map<string, StateDemographicGroup[]>,
  countryId: string,
  stateId: string
): { groups: StateDemographicGroup[] } | undefined {
  const groups = groupsByState.get(`${countryId}:${stateId}`);
  return groups && groups.length > 0 ? { groups } : undefined;
}

/**
 * Compute national averages per category/metric from an array of state metrics.
 * Used by calculateStateApproval and by getStateApprovalForElection.
 */
export function computeNationalAveragesFromMetrics(
  allMetrics: StateMetrics[]
): Record<string, Record<string, number>> {
  const averages: Record<string, Record<string, number>> = {};
  for (const category of CATEGORIES) {
    averages[category] = {};
    if (allMetrics.length === 0) continue;
    const sample = allMetrics.find((m) => (m[category] as Record<string, unknown>) != null);
    if (!sample) continue;
    const metricKeys = Object.keys((sample[category] as Record<string, { value: number }>) || {});
    for (const key of metricKeys) {
      const values = allMetrics
        .map((m) => (m[category] as Record<string, { value: number }>)?.[key]?.value)
        .filter((v): v is number => v !== undefined && Number.isFinite(v));
      if (values.length > 0) {
        averages[category][key] = values.reduce((a, b) => a + b, 0) / values.length;
      }
    }
  }
  return averages;
}

function getMetricValue(
  metrics: StateMetrics,
  category: MetricCategoryId,
  metricId: string
): number | null {
  const cat = metrics[category] as Record<string, { value: number }> | undefined;
  return cat?.[metricId]?.value ?? null;
}

/** Build a flat category→metric→value map from a StateMetrics document. */
export function buildFlatMetrics(
  stateMetrics: StateMetrics
): Record<string, Record<string, number>> {
  const flat: Record<string, Record<string, number>> = {};
  for (const category of CATEGORIES) {
    const catData = stateMetrics[category] as Record<string, { value: number }> | undefined;
    if (!catData) continue;
    flat[category] = {};
    for (const [k, v] of Object.entries(catData)) {
      if (v && typeof v === "object" && "value" in v)
        flat[category][k] = (v as { value: number }).value;
    }
  }
  return flat;
}

/**
 * Pre-modifier state approval score — pure metric-vs-average comparison (0–100).
 * Use calculateStateApproval for the modifier-adjusted final score.
 */
export function computeStateApprovalBase(
  stateMetrics: StateMetrics,
  nationalAverages: Record<string, Record<string, number>>,
  weighting?: { groups: StateDemographicGroup[] },
  // This is a CALCULATION util, not a seeder: a wrong preset here yields a
  // wrong approval number, it does not write modern data into a historical
  // world. It also sits after an optional parameter, so making it required
  // needs a signature reorder across every caller. Tracked on #3908.
  // eslint-disable-next-line no-restricted-syntax
  preset: string = "2019-default",
  /** Live year (null while the era flag is off) — gates inactive-metric terms. */
  year: number | null = null
): number {
  // P6d: when demographic groups are supplied, each metric's contribution is
  // scaled by how much the state's electorate (its ideological mix) cares about
  // it. With no groups (or k=0) every weight is 1 → the ideology-blind average.
  const groups = weighting?.groups;
  const excluded = getApprovalExcludedMetrics(preset, year);
  let weightedSum = 0;
  let weightTotal = 0;
  for (const category of CATEGORIES) {
    const catData = stateMetrics[category] as Record<string, { value: number }> | undefined;
    if (!catData) continue;
    const avgCat = nationalAverages[category];
    if (!avgCat) continue;
    for (const metricId of Object.keys(catData)) {
      if (excluded.has(metricId)) continue;
      if (!isMetricActive(metricId, stateMetrics.countryId, year)) continue;
      const value = getMetricValue(stateMetrics, category, metricId);
      const avg = avgCat[metricId];
      if (value == null || avg == null || !Number.isFinite(value) || !Number.isFinite(avg))
        continue;
      const higherBetter = IS_HIGHER_BETTER[metricId] ?? true;
      // Normalize by |avg| so the deviation's SIGN tracks (value − avg) even when
      // the national average is negative (e.g. budgetBalance deficits) — a signed
      // denom would invert a worse deficit into a positive approval term.
      const denom = Math.abs(avg) < 1e-6 ? 1 : Math.abs(avg);
      const pctDiff = (value - avg) / denom;
      const signedDiff = higherBetter ? pctDiff : -pctDiff;
      const contribution = Math.max(
        -MAX_CONTRIBUTION,
        Math.min(MAX_CONTRIBUTION, signedDiff * CONTRIBUTION_SCALE)
      );
      const weight = groups
        ? effectiveMetricWeight(axisAffinityFor(metricId), groups, APPROVAL_AXIS_WEIGHT_K)
        : 1;
      weightedSum += contribution * weight;
      weightTotal += weight;
    }
  }
  if (weightTotal === 0) return BASE_APPROVAL;
  const adjustment = (weightedSum / weightTotal) * 2.5;
  return Math.max(0, Math.min(100, Math.round((BASE_APPROVAL + adjustment) * 10) / 10));
}

/**
 * Pre-modifier national approval — pure metric comparison on flat averages maps (0–100).
 * Use calculateApprovalFromAverages for the modifier-adjusted final score.
 */
export function computeApprovalBaseFromAverages(
  values: Record<string, Record<string, number>>,
  referenceAverages: Record<string, Record<string, number>>,
  // Calculation util, not a seeder; see the note on computeStateApprovalBase.
  // Tracked on #3908.
  // eslint-disable-next-line no-restricted-syntax
  preset: string = "2019-default",
  countryId?: string | null,
  /** Live year (null while the era flag is off) — gates inactive-metric terms. */
  year: number | null = null
): number {
  const excluded = getApprovalExcludedMetrics(preset, year);
  let sum = 0;
  let count = 0;
  for (const category of CATEGORIES) {
    const catValues = values[category];
    const catRef = referenceAverages[category];
    if (!catValues || !catRef) continue;
    for (const metricId of Object.keys(catValues)) {
      if (excluded.has(metricId)) continue;
      if (!isMetricActive(metricId, countryId ?? undefined, year)) continue;
      const value = catValues[metricId];
      const avg = catRef[metricId];
      if (!Number.isFinite(value) || !Number.isFinite(avg)) continue;
      const higherBetter = IS_HIGHER_BETTER[metricId] ?? true;
      // Normalize by |avg| so the deviation's SIGN tracks (value − avg) even when
      // the national average is negative (e.g. budgetBalance deficits) — a signed
      // denom would invert a worse deficit into a positive approval term.
      const denom = Math.abs(avg) < 1e-6 ? 1 : Math.abs(avg);
      const pctDiff = (value - avg) / denom;
      const signedDiff = higherBetter ? pctDiff : -pctDiff;
      sum += Math.max(
        -MAX_CONTRIBUTION,
        Math.min(MAX_CONTRIBUTION, signedDiff * CONTRIBUTION_SCALE)
      );
      count++;
    }
  }
  if (count === 0) return BASE_APPROVAL;
  const adjustment = (sum / count) * 2.5;
  return Math.max(0, Math.min(100, Math.round((BASE_APPROVAL + adjustment) * 10) / 10));
}

/**
 * Compute state government approval from metrics vs national averages.
 * Applies named modifiers on top of the base metric score. Returns 0–100.
 *
 * @param extraModifiers Optional caller-supplied modifiers (e.g. governor's
 *   State of the State address approval bump). Callers fetch active sources
 *   asynchronously and pass the resolved modifiers here.
 */
export function calculateStateApproval(
  stateMetrics: StateMetrics,
  nationalAverages: Record<string, Record<string, number>>,
  extraModifiers: ActiveModifier[] = [],
  weighting: { groups: StateDemographicGroup[] } | undefined,
  // `preset` is REQUIRED: it selects the era-appropriate excluded-metric set for
  // the base AND the era-gated named modifiers. Making it optional let callers
  // silently score approval with the 2019 ruleset regardless of the live preset,
  // so the region hero, the per-turn snapshot, and the rankings disagreed under
  // non-2019 presets (fix/region-approval). Pass `null` only to mean "use the
  // 2019 default" explicitly.
  preset: string | null,
  // `year` is REQUIRED for the same reason: when the era-aware approval flag is
  // on, every scoring surface must drift together or the hero, snapshot, and
  // rankings disagree again. Pass the year from getEraContext(db) (null while
  // the flag is off) — never omit it silently.
  year: number | null,
  // SP4: for LAW_COUNTRY_IDS the metric base comes from the hybrid political
  // approval provider (loadPoliticalApprovalBases) instead of the legacy
  // stateMetrics comparison. Named modifiers still apply on top either way.
  baseOverride?: number
): number {
  const base = Number.isFinite(baseOverride)
    ? (baseOverride as number)
    : computeStateApprovalBase(
        stateMetrics,
        nationalAverages,
        weighting,
        preset ?? undefined,
        year
      );
  const metricModifiers = evaluateModifiers(buildFlatMetrics(stateMetrics), {
    preset,
    countryId: stateMetrics.countryId,
    year,
  });
  return applyModifiers(base, [...metricModifiers, ...extraModifiers]);
}

/**
 * Score a country's national averages against global averages (all countries combined).
 * Applies named modifiers on top of the base score. Returns 0–100.
 */
export function calculateApprovalFromAverages(
  values: Record<string, Record<string, number>>,
  referenceAverages: Record<string, Record<string, number>>,
  preset?: string | null,
  countryId?: string | null,
  /** Live year from getEraContext (null while the era-aware flag is off). */
  year?: number | null,
  /** SP4: hybrid political base for LAW_COUNTRY_IDS (see calculateStateApproval). */
  baseOverride?: number
): number {
  const base = Number.isFinite(baseOverride)
    ? (baseOverride as number)
    : computeApprovalBaseFromAverages(
        values,
        referenceAverages,
        preset ?? undefined,
        countryId,
        year ?? null
      );
  return applyModifiers(base, evaluateModifiers(values, { preset, countryId, year }));
}

/**
 * Compute national government approval as population-weighted average of state approvals.
 */
export function calculateNationalApproval(
  stateApprovals: { stateId: string; approval: number; population: number }[]
): number {
  const totalPop = stateApprovals.reduce((s, x) => s + x.population, 0);
  if (totalPop === 0) return BASE_APPROVAL;
  const weighted = stateApprovals.reduce((s, x) => s + x.approval * x.population, 0) / totalPop;
  return Math.max(0, Math.min(100, Math.round(weighted * 10) / 10));
}

/**
 * Pull active governor-address approval bumps for every state in a country in
 * one query, grouped by stateId. Used by snapshotApprovalHistory so per-turn
 * snapshots include the State of the State bump without an O(N) round trip.
 */
async function getActiveAddressModifiersByState(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<Map<string, ActiveModifier[]>> {
  const active = await db
    .collection("governorAddresses")
    .find({ countryId, "approvalEffect.expiresAtTurn": { $gt: currentTurn } })
    .toArray();
  const map = new Map<string, ActiveModifier[]>();
  for (const addr of active as Array<{
    _id: import("mongodb").ObjectId;
    stateId: string;
    title?: string;
    deliveredByName: string;
    approvalEffect: { amount: number; expiresAtTurn: number };
  }>) {
    const mod: ActiveModifier = {
      id: `address:${addr._id.toString()}`,
      label: addr.title ? `Address: "${addr.title}"` : `Address by ${addr.deliveredByName}`,
      effect: addr.approvalEffect.amount,
    };
    const list = map.get(addr.stateId) ?? [];
    list.push(mod);
    map.set(addr.stateId, list);
  }
  return map;
}

/**
 * Maximum points a state's stored approval rating may move per turn.
 *
 * Approval is a pure function of live metrics, so metric shocks used to jump
 * the stored rating (and everything reading it: coattails, charts, the
 * national aggregate) several points in a single turn. Issue #2891 item 1:
 * approval moving 37 to 43 in about 2 days was owner-agreed too fast.
 * Damping the SNAPSHOT keeps the derived target intact while the stored,
 * player-visible and election-consumed rating steps toward it at most this
 * many points per turn.
 */
export const APPROVAL_MAX_STEP_PER_TURN = 2;

/**
 * Step `prev` toward `target` by at most `maxStep` points. Pure; adopts the
 * target directly when there is no previous value (first snapshot).
 */
export function dampApprovalStep(
  prev: number | undefined,
  target: number,
  maxStep: number = APPROVAL_MAX_STEP_PER_TURN
): number {
  if (prev == null || !Number.isFinite(prev)) return target;
  const delta = target - prev;
  if (Math.abs(delta) <= maxStep) return target;
  return prev + Math.sign(delta) * maxStep;
}

interface StateApprovalBulkOp {
  updateOne: {
    filter: { _id: string };
    update: {
      $set: { stateId: string; countryId: CountryId; approvalRating: number; updatedAt: Date };
      $push: {
        history: { $each: Array<{ turn: number; approval: number; net: number }>; $slice: number };
      };
    };
    upsert: boolean;
  };
}

/**
 * Build the per-region `stateApprovalHistory` bulk-write operations for a turn.
 * Pure (no DB) so it can be unit-tested; each op upserts the region doc and
 * pushes one history entry capped at the last 20 turns — mirroring the national
 * `governmentApprovals` snapshot at region scope.
 */
export function buildStateApprovalBulkOps(
  stateApprovals: Array<{ stateId: string; approval: number }>,
  countryId: CountryId,
  turn: number,
  now: Date
): StateApprovalBulkOp[] {
  return stateApprovals.map(({ stateId, approval }) => ({
    updateOne: {
      filter: { _id: stateId },
      update: {
        $set: { stateId, countryId, approvalRating: approval, updatedAt: now },
        $push: {
          // net = approval − disapproval = approval − (100 − approval)
          history: { $each: [{ turn, approval, net: approval - (100 - approval) }], $slice: -20 },
        },
      },
      upsert: true,
    },
  }));
}

/**
 * Snapshot the current approval rating to the governmentApprovals collection.
 * Called each turn. History is capped at the last 20 entries.
 */
export async function snapshotApprovalHistory(
  db: Db,
  countryId: CountryId,
  turn: number
): Promise<void> {
  const statesCol = db.collection<State>("states");

  // Score approval with the live era's ruleset. Omitting this silently used the
  // 2019 excluded-metric set + 2019 named modifiers, so the stored snapshot (which
  // the chart, national rating, and rankings read) drifted from the live display
  // paths under non-2019 presets (fix/region-approval). getEraContext also
  // supplies the live year when the era-aware approval flag is on (null when off).
  const { preset, year } = await getEraContext(db);

  const stateIds = await statesCol.distinct("_id", { countryId });
  const [allMetrics, allStates, allDemographics] = await Promise.all([
    // Scope the metrics fetch to the same country so a cross-country state-ID
    // collision (CN HB / DE HB) can't pull in another country's metrics.
    // SP5: merged two-store view (macro + political halves).
    findMergedRegionMetricsMany(db, { _id: { $in: stateIds }, countryId }),
    statesCol.find({ countryId }, { projection: { _id: 1, population: 1 } }).toArray(),
    // P6d: per-state demographic groups drive the electorate-weighted approval.
    // Scoped by countryId like the metrics fetch above so a cross-country
    // state-ID collision (CN HB / DE HB) can't pull the wrong electorate.
    db
      .collection<StateDemographics>("stateDemographics")
      .find({ _id: { $in: stateIds }, countryId }, { projection: { _id: 1, groups: 1 } })
      .toArray(),
  ]);

  // The war block is computed BEFORE the metrics guard below, and persisted on
  // both sides of it. At peace its target is zero, so it retires at the damping
  // step rather than vanishing — but only if it is stepped every turn. A country
  // that returns early here would otherwise freeze its war total forever.
  const approvalDoc = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .findOne({ _id: countryId }, { projection: { warApprovalTotal: 1 } });
  const war = await computeWarApproval(db, countryId, turn, approvalDoc?.warApprovalTotal);

  if (allMetrics.length === 0) {
    // No rating to write, but the block still has to move. Only the total is
    // written: the address and org providers are not run on this path, so
    // storing a war-only modifier list would drop those chips from beside a
    // rating that still includes them. A stale list matching a stale rating is
    // better than a fresh list that contradicts it.
    //
    // `upsert: false` — a country with neither metrics nor an approval document
    // has nothing to retire, and inventing one here would create a document
    // missing every other required field.
    await db
      .collection<GovernmentApproval>("governmentApprovals")
      .updateOne({ _id: countryId }, { $set: { warApprovalTotal: war.total } });
    return;
  }

  const statePopMap = new Map(allStates.map((s) => [s._id, s.population ?? 0]));
  const groupsByState = new Map<string, StateDemographicGroup[]>(
    allDemographics.map((d) => [d._id, Object.values(d.groups ?? {})])
  );
  const nationalAverages = computeNationalAveragesFromMetrics(allMetrics);
  // SP4: playable countries score their metric base from the hybrid political
  // model — one provider call per snapshot, applied as baseOverride so
  // modifiers/damping below stay identical. A playable region missing from the
  // map (or an unseeded world) falls to BASE_APPROVAL, never the legacy scorer.
  const politicalBases = isPoliticalApprovalCountry(countryId)
    ? await loadPoliticalApprovalBases(db, countryId)
    : null;
  // Pull active governor-address approval modifiers per state in one query
  // so each state's snapshot includes any in-flight State of the State bump.
  const addressModifiersByState = await getActiveAddressModifiersByState(db, countryId, turn);
  // Fairness Act drag: a few-point approval penalty per state whose live
  // congressional map exceeds its efficiency-gap ceiling (empty when the
  // redistricting flag is off or the country has no district docs).
  const fairnessModifiersByState = await getActiveFairnessGapModifiers(db, countryId);
  const stateApprovals = allMetrics.map((m) => {
    const groups = groupsByState.get(m._id);
    return {
      stateId: m._id,
      approval: calculateStateApproval(
        m,
        nationalAverages,
        [
          ...(addressModifiersByState.get(m._id) ?? []),
          ...(fairnessModifiersByState.get(m._id) ?? []),
        ],
        groups && groups.length > 0 ? { groups } : undefined,
        preset,
        year,
        isPoliticalApprovalCountry(countryId)
          ? (politicalBases?.byRegion.get(m._id) ?? BASE_APPROVAL)
          : undefined
      ),
      population: statePopMap.get(m._id) ?? 0,
    };
  });

  // Per-turn damping (issue #2891 item 1): step each state's stored rating
  // toward its freshly derived target by at most APPROVAL_MAX_STEP_PER_TURN
  // points instead of jumping. The damped values feed both the per-state
  // snapshot and the national aggregate, so every reader of the stored
  // ratings (charts, rankings, coattails) sees the same smoothed series.
  const prevDocs = await db
    .collection<StateApprovalHistory>("stateApprovalHistory")
    .find(
      { _id: { $in: stateApprovals.map((s) => s.stateId) }, countryId },
      { projection: { _id: 1, approvalRating: 1 } }
    )
    .toArray();
  const prevByState = new Map(prevDocs.map((d) => [d._id, d.approvalRating]));
  const dampedStateApprovals = stateApprovals.map((s) => ({
    ...s,
    approval: dampApprovalStep(prevByState.get(s.stateId), s.approval),
  }));

  let approval = calculateNationalApproval(dampedStateApprovals);

  // Every national-scope modifier goes through ONE applyModifiers call.
  //
  //  - the head-of-government address bump, applied at country level rather than
  //    cascaded through per-state approvals so it shows on the national rating
  //    without bumping every state;
  //  - international joint statements about this country, bounded and time
  //    limited, which lift cleanly when the statement lapses;
  //  - the war block, already damped as a block by computeWarApproval.
  //
  // One call rather than a chain: each call independently clamps to [0,100] and
  // rounds to a tenth, and each gets its own POSITIVE_MODIFIER_NET_CAP — so
  // chaining rounds twice and lets each source spend the cap the others are
  // subject to. The stored modifier list is exactly what this call consumed, so
  // the chips a reader shows cannot disagree with the rating beside them.
  const nationalAddressMods = await getActiveNationalAddressModifier(db, countryId, turn);
  const orgStatementMods = await getActiveOrgStatementModifiersByCountry(db, countryId, turn);
  const nationalMods = [...nationalAddressMods, ...orgStatementMods, ...war.modifiers];
  approval = applyModifiers(approval, nationalMods);

  // Penalise national approval if the country has no confirmed cabinet members.
  const cabinetMembers = await db.collection("cabinetMembers").find({ countryId }).toArray();
  if (cabinetMembers.length === 0) {
    approval = Math.max(0, approval - NO_CABINET_PENALTY);
  }

  // Penalise approval for acting (unconfirmed) appointments when the country
  // uses Senate confirmation — each acting member costs 0.5 approval points.
  if (actingAppointmentsEnabled(countryId)) {
    const actingCount = cabinetMembers.filter(
      (m) => (m as { acting?: boolean }).acting === true
    ).length;
    if (actingCount > 0) {
      approval = Math.max(0, approval - actingCount * ACTING_APPOINTMENT_PENALTY);
    }
  }

  await db.collection<GovernmentApproval>("governmentApprovals").updateOne(
    { _id: countryId },
    {
      $set: {
        countryId,
        approvalRating: approval,
        disapprovalRating: 100 - approval,
        netApproval: approval - (100 - approval),
        source: "aggregate" as const,
        warApprovalTotal: war.total,
        activeNationalModifiers: nationalMods,
        updatedAt: new Date(),
      },
      $push: {
        history: { $each: [{ turn, approval, net: approval - (100 - approval) }], $slice: -20 },
      },
    },
    { upsert: true }
  );

  // Per-region approval history (mirrors the national snapshot at region scope)
  // so the regional metrics tab can chart approval over time. Uses the same
  // per-state approvals computed above (incl. governor-address modifiers).
  const stateApprovalOps = buildStateApprovalBulkOps(
    dampedStateApprovals.map((s) => ({ stateId: s.stateId, approval: s.approval })),
    countryId,
    turn,
    new Date()
  );
  if (stateApprovalOps.length > 0) {
    await db
      .collection<StateApprovalHistory>("stateApprovalHistory")
      .bulkWrite(stateApprovalOps as AnyBulkWriteOperation<StateApprovalHistory>[]);
  }
}
