/**
 * Factor ledger — a read-only, descriptive decomposition of why a
 * presidential candidate is ahead or behind, broken into named factors.
 *
 * WHAT THIS IS (and is not)
 * -------------------------
 * The ledger is teed straight off the values the vote engine has ALREADY
 * computed for a turn (nominal appeal, swing flows, spoiler transfers, the
 * per-unit post-multiplier stages, and the referendum share shift). It never
 * recomputes vote math and it changes no outcome — it is a pure observation of
 * the engine's own locals, aggregated into a small waterfall the UI can render.
 *
 * The load-bearing invariant is anti-drift: for every candidate,
 *
 *     baseline + Σ factor.voteDelta === finalVotes === engine total
 *
 * so the reconstructed waterfall always sums back to the votes the engine
 * actually stored. `uncertainty` is the residual line that absorbs the
 * float→integer rounding the per-unit pipeline does at each stage, so the
 * equality holds exactly regardless of how cleanly the multiplicative stages
 * decompose. See {@link assertLedgerReconstructs}.
 *
 * ATTRIBUTION (the code documents these on purpose)
 * -------------------------------------------------
 *  - REACH is name recognition. For the presidential general the engine sets
 *    `includeInfluenceInAppeal = false`, so politicalInfluence / nationalInfluence
 *    feed reach ONLY (via `normalizeNPI` in `appealWeight`), never candidateFit.
 *  - candidateFit is policy alignment (`calcAppeal`'s position + directional
 *    terms) — never influence, never favorability.
 *  - Favorability feeds APPROVAL, which is a structural standing term folded
 *    into `stateBaseline` (alongside org, registration, regime, and the state
 *    partisan-lean multiplier), never candidateFit or reach.
 *  - The demographic axis is the granular (dimension, bucket) census substrate.
 *    `bucketAppeal` aggregates per-cell appeal contributions back to census
 *    buckets via each cell's `bucketWeights`. Archetypes are never read or
 *    emitted here.
 */

export type FactorKey =
  | "stateBaseline"
  | "nationalEnvironment"
  | "candidateFit"
  | "reach"
  | "campaign"
  | "turnout"
  | "swing"
  | "spoiler"
  | "uncertainty";

/** Player-facing label per factor key. Carried in the data like the National
 *  Mood component rows, so the card renders it directly. */
export const FACTOR_LABELS: Record<FactorKey, string> = {
  stateBaseline: "State lean & standing",
  nationalEnvironment: "National mood",
  candidateFit: "Policy fit",
  reach: "Name recognition",
  campaign: "Campaign",
  turnout: "Turnout",
  swing: "Persuasion swing",
  spoiler: "Spoiler effect",
  uncertainty: "Other",
};

/** Order the waterfall renders in (baseline first, residual last). */
export const FACTOR_ORDER: FactorKey[] = [
  "stateBaseline",
  "candidateFit",
  "reach",
  "turnout",
  "swing",
  "spoiler",
  "nationalEnvironment",
  "campaign",
  "uncertainty",
];

export interface FactorContribution {
  key: FactorKey;
  label: string;
  /** Descriptive effective multiplier for multiplicative stages (undefined for
   *  purely additive stages). Display only — never part of the reconstruction. */
  multiplier?: number;
  /** Signed additive contribution, in votes. */
  voteDelta: number;
}

export interface CandidateUnitLedger {
  candidateId: string;
  unitId: string;
  /** Neutral pool-share baseline for this unit (pre-factor). */
  nominalWeight: number;
  /** Equals the engine's stored `newTotalVotesByUnit[unit][candidate]`. */
  finalVotes: number;
  factors: FactorContribution[];
}

export interface CandidateBucketAppeal {
  candidateId: string;
  /** Census bucket key ("dimension:bucket", e.g. "race:white"). */
  bucket: string;
  /** Share of this candidate's appeal contributed by the bucket (sums to ~1). */
  appealShare: number;
  /** Contribution-weighted mean economic lean of the bucket. */
  demoEP: number;
  /** Contribution-weighted mean social lean of the bucket. */
  demoSP: number;
}

export interface CandidateNationalLedger {
  candidateId: string;
  nominalWeight: number;
  /** Equals the engine's stored national total for this candidate. */
  finalVotes: number;
  factors: FactorContribution[];
  bucketAppeal?: CandidateBucketAppeal[];
}

export interface FactorLedgerSnapshot {
  recordedTurn: number;
  byCandidateNational: CandidateNationalLedger[];
  /** Bounded to the closest-margin units so the document stays small. */
  byCandidateUnit?: CandidateUnitLedger[];
}

// ─── Sink internals ─────────────────────────────────────────────────────────

/** Per-cell appeal decomposition the swing-flow already computed. */
export interface CellAppealDecomposition {
  /** Neutral base (votes a weight-1 contender takes in this cell). */
  base: number;
  /** Additive delta from the reach multiplicand. */
  reachDelta: number;
  /** Additive delta from the candidate-fit (appeal) multiplicand. */
  fitDelta: number;
  /** Additive delta from every remaining structural multiplicand. */
  restDelta: number;
}

interface UnitCandidateRecord {
  // Pre-support cell sums (scaled by support at finalize).
  base: number;
  reach: number;
  fit: number;
  rest: number;
  support: number;
  // Post-support swing-flow deltas.
  swingDelta: number;
  spoilerDelta: number;
  // Post-swing-flow per-unit pipeline stages (recorded by the engine).
  referendumDelta: number;
  independentDelta: number;
  leanDelta: number;
  campaignDelta: number;
  finalVotes: number;
  /** 1 / strengthMultiplier (votes at neutral turnout). Defaults to 1. */
  neutralFactor: number;
}

interface BucketAccum {
  votes: number;
  ep: number;
  sp: number;
}

function emptyRecord(): UnitCandidateRecord {
  return {
    base: 0,
    reach: 0,
    fit: 0,
    rest: 0,
    support: 1,
    swingDelta: 0,
    spoilerDelta: 0,
    referendumDelta: 0,
    independentDelta: 0,
    leanDelta: 0,
    campaignDelta: 0,
    finalVotes: 0,
    neutralFactor: 1,
  };
}

/**
 * Stateful accumulator threaded through one presidential accumulation turn.
 * Every method is pure observation of engine locals; nothing here feeds back
 * into vote math.
 */
export class LedgerSink {
  private units = new Map<string, Map<string, UnitCandidateRecord>>();
  private bucketAppeal = new Map<string, Map<string, BucketAccum>>();

  private recordFor(unitId: string, candidateId: string): UnitCandidateRecord {
    let byCand = this.units.get(unitId);
    if (!byCand) {
      byCand = new Map();
      this.units.set(unitId, byCand);
    }
    let rec = byCand.get(candidateId);
    if (!rec) {
      rec = emptyRecord();
      byCand.set(candidateId, rec);
    }
    return rec;
  }

  /**
   * Record one cell's per-candidate appeal contribution and its multiplicative
   * decomposition. `bucketWeights` ("dim:bucket" → 0..1) is present only on the
   * granular census substrate; when supplied the contribution is folded into
   * the candidate's national bucket appeal.
   */
  recordCellAppeal(
    unitId: string,
    candidateId: string,
    votes: number,
    demoEP: number,
    demoSP: number,
    decomp: CellAppealDecomposition,
    bucketWeights?: Record<string, number>
  ): void {
    const rec = this.recordFor(unitId, candidateId);
    rec.base += decomp.base;
    rec.reach += decomp.reachDelta;
    rec.fit += decomp.fitDelta;
    rec.rest += decomp.restDelta;

    if (bucketWeights && votes !== 0) {
      let byBucket = this.bucketAppeal.get(candidateId);
      if (!byBucket) {
        byBucket = new Map();
        this.bucketAppeal.set(candidateId, byBucket);
      }
      for (const [bucket, w] of Object.entries(bucketWeights)) {
        if (!w) continue;
        const contribution = votes * w;
        const acc = byBucket.get(bucket) ?? { votes: 0, ep: 0, sp: 0 };
        acc.votes += contribution;
        acc.ep += demoEP * contribution;
        acc.sp += demoSP * contribution;
        byBucket.set(bucket, acc);
      }
    }
  }

  /**
   * Close out a candidate's swing-flow contribution for a unit: the support
   * multiplier (scales the pre-support cell sums) plus the post-support swing
   * and spoiler deltas the engine already computed.
   */
  finalizeUnitCandidate(
    unitId: string,
    candidateId: string,
    values: { support: number; swingDelta: number; spoilerDelta: number }
  ): void {
    const rec = this.recordFor(unitId, candidateId);
    rec.support = values.support;
    rec.swingDelta = values.swingDelta;
    rec.spoilerDelta = values.spoilerDelta;
  }

  /** Record the unit's turnout scaler so turnout can be peeled from baseline. */
  setUnitTurnout(unitId: string, strengthMultiplier: number): void {
    const byCand = this.units.get(unitId);
    if (!byCand) return;
    const neutralFactor = strengthMultiplier > 0 ? 1 / strengthMultiplier : 1;
    for (const rec of byCand.values()) rec.neutralFactor = neutralFactor;
  }

  recordReferendum(unitId: string, candidateId: string, voteDelta: number): void {
    this.recordFor(unitId, candidateId).referendumDelta = voteDelta;
  }

  /** Signed independent-penalty vote delta (folds into stateBaseline). */
  recordIndependentPenalty(unitId: string, candidateId: string, voteDelta: number): void {
    this.recordFor(unitId, candidateId).independentDelta = voteDelta;
  }

  /** Signed state partisan-lean vote delta (folds into stateBaseline). */
  recordLean(unitId: string, candidateId: string, voteDelta: number): void {
    this.recordFor(unitId, candidateId).leanDelta = voteDelta;
  }

  /** Signed campaign vote delta (ground game + VP + governor + strength). */
  recordCampaign(unitId: string, candidateId: string, voteDelta: number): void {
    this.recordFor(unitId, candidateId).campaignDelta = voteDelta;
  }

  /** The integer votes the engine actually added for this unit + candidate. */
  recordFinalVotes(unitId: string, candidateId: string, votes: number): void {
    this.recordFor(unitId, candidateId).finalVotes = votes;
  }

  /** @internal — consumed by {@link assembleNationalLedger}. */
  getUnits(): Map<string, Map<string, UnitCandidateRecord>> {
    return this.units;
  }

  /** @internal — consumed by {@link assembleNationalLedger}. */
  getBucketAppeal(): Map<string, Map<string, BucketAccum>> {
    return this.bucketAppeal;
  }
}

export function createLedgerSink(): LedgerSink {
  return new LedgerSink();
}

// ─── Assembly ────────────────────────────────────────────────────────────────

interface ComponentBreakdown {
  baseline: number;
  reach: number;
  candidateFit: number;
  stateBaselineStruct: number;
  swing: number;
  spoiler: number;
  turnout: number;
  nationalEnvironment: number;
  stateBaselineExtra: number;
  campaign: number;
  finalVotes: number;
}

function componentsOf(rec: UnitCandidateRecord): ComponentBreakdown {
  const s = rec.support;
  const base = rec.base * s;
  const reach = rec.reach * s;
  const fit = rec.fit * s;
  const rest = rec.rest * s;
  const raw = base + reach + fit + rest + rec.swingDelta + rec.spoilerDelta;
  const n = rec.neutralFactor;
  return {
    baseline: base * n,
    reach: reach * n,
    candidateFit: fit * n,
    stateBaselineStruct: rest * n,
    swing: rec.swingDelta * n,
    spoiler: rec.spoilerDelta * n,
    turnout: raw * (1 - n),
    nationalEnvironment: rec.referendumDelta,
    stateBaselineExtra: rec.independentDelta + rec.leanDelta,
    campaign: rec.campaignDelta,
    finalVotes: rec.finalVotes,
  };
}

function addComponents(a: ComponentBreakdown, b: ComponentBreakdown): void {
  a.baseline += b.baseline;
  a.reach += b.reach;
  a.candidateFit += b.candidateFit;
  a.stateBaselineStruct += b.stateBaselineStruct;
  a.swing += b.swing;
  a.spoiler += b.spoiler;
  a.turnout += b.turnout;
  a.nationalEnvironment += b.nationalEnvironment;
  a.stateBaselineExtra += b.stateBaselineExtra;
  a.campaign += b.campaign;
  a.finalVotes += b.finalVotes;
}

function zeroComponents(): ComponentBreakdown {
  return {
    baseline: 0,
    reach: 0,
    candidateFit: 0,
    stateBaselineStruct: 0,
    swing: 0,
    spoiler: 0,
    turnout: 0,
    nationalEnvironment: 0,
    stateBaselineExtra: 0,
    campaign: 0,
    finalVotes: 0,
  };
}

function factor(key: FactorKey, voteDelta: number, baseline: number): FactorContribution {
  const out: FactorContribution = { key, label: FACTOR_LABELS[key], voteDelta };
  // A descriptive multiplier for the stages that read as a scaling of baseline.
  if (
    baseline > 0 &&
    (key === "stateBaseline" || key === "candidateFit" || key === "reach" || key === "turnout")
  ) {
    out.multiplier = 1 + voteDelta / baseline;
  }
  return out;
}

function buildFactors(comp: ComponentBreakdown): {
  baseline: number;
  factors: FactorContribution[];
  finalVotes: number;
} {
  const baseline = comp.baseline;
  const stateBaseline = comp.stateBaselineStruct + comp.stateBaselineExtra;
  const named: Array<[FactorKey, number]> = [
    ["stateBaseline", stateBaseline],
    ["candidateFit", comp.candidateFit],
    ["reach", comp.reach],
    ["turnout", comp.turnout],
    ["swing", comp.swing],
    ["spoiler", comp.spoiler],
    ["nationalEnvironment", comp.nationalEnvironment],
    ["campaign", comp.campaign],
  ];
  let sum = baseline;
  for (const [, delta] of named) sum += delta;
  const uncertainty = comp.finalVotes - sum;
  named.push(["uncertainty", uncertainty]);

  const byKey = new Map(named);
  const factors = FACTOR_ORDER.map((key) => factor(key, byKey.get(key) ?? 0, baseline));
  return { baseline, factors, finalVotes: comp.finalVotes };
}

function buildBucketAppeal(
  byBucket: Map<string, BucketAccum> | undefined,
  candidateId: string,
  topBuckets: number
): CandidateBucketAppeal[] | undefined {
  if (!byBucket || byBucket.size === 0) return undefined;
  let total = 0;
  for (const acc of byBucket.values()) total += acc.votes;
  if (total <= 0) return undefined;
  const rows: CandidateBucketAppeal[] = [];
  for (const [bucket, acc] of byBucket) {
    if (acc.votes <= 0) continue;
    rows.push({
      candidateId,
      bucket,
      appealShare: acc.votes / total,
      demoEP: acc.ep / acc.votes,
      demoSP: acc.sp / acc.votes,
    });
  }
  rows.sort((a, b) => b.appealShare - a.appealShare);
  return rows.slice(0, topBuckets);
}

export interface AssembleOptions {
  /** How many closest-margin units to keep in `byCandidateUnit`. */
  topUnits?: number;
  /** How many top buckets to keep per candidate in `bucketAppeal`. */
  topBuckets?: number;
}

/**
 * Fold the sink's per-unit records into the national waterfall (and a bounded
 * set of closest-margin units). Pure — reads the sink, builds the snapshot.
 */
export function assembleNationalLedger(
  sink: LedgerSink,
  recordedTurn: number,
  options?: AssembleOptions
): FactorLedgerSnapshot {
  const topUnits = options?.topUnits ?? 12;
  const topBuckets = options?.topBuckets ?? 8;
  const units = sink.getUnits();
  const bucketAppealByCand = sink.getBucketAppeal();

  // National aggregation.
  const nationalComp = new Map<string, ComponentBreakdown>();
  for (const byCand of units.values()) {
    for (const [candidateId, rec] of byCand) {
      const comp = nationalComp.get(candidateId) ?? zeroComponents();
      addComponents(comp, componentsOf(rec));
      nationalComp.set(candidateId, comp);
    }
  }

  const byCandidateNational: CandidateNationalLedger[] = [];
  for (const [candidateId, comp] of nationalComp) {
    const { baseline, factors, finalVotes } = buildFactors(comp);
    const bucketAppeal = buildBucketAppeal(
      bucketAppealByCand.get(candidateId),
      candidateId,
      topBuckets
    );
    byCandidateNational.push({
      candidateId,
      nominalWeight: baseline,
      finalVotes,
      factors,
      ...(bucketAppeal ? { bucketAppeal } : {}),
    });
  }
  byCandidateNational.sort((a, b) => b.finalVotes - a.finalVotes);

  // Closest-margin unit selection (mirrors the unitTurnSnapshots slice
  // discipline — keep the document small by keeping only the units where the
  // breakdown actually decides something).
  const unitMargins: Array<{ unitId: string; margin: number }> = [];
  for (const [unitId, byCand] of units) {
    const totals = [...byCand.values()].map((r) => r.finalVotes).sort((a, b) => b - a);
    const margin = totals.length >= 2 ? totals[0] - totals[1] : (totals[0] ?? 0);
    unitMargins.push({ unitId, margin });
  }
  unitMargins.sort((a, b) => a.margin - b.margin);
  const selectedUnitIds = new Set(unitMargins.slice(0, topUnits).map((u) => u.unitId));

  const byCandidateUnit: CandidateUnitLedger[] = [];
  for (const unitId of selectedUnitIds) {
    const byCand = units.get(unitId);
    if (!byCand) continue;
    for (const [candidateId, rec] of byCand) {
      const { baseline, factors, finalVotes } = buildFactors(componentsOf(rec));
      byCandidateUnit.push({ candidateId, unitId, nominalWeight: baseline, finalVotes, factors });
    }
  }

  return {
    recordedTurn,
    byCandidateNational,
    ...(byCandidateUnit.length > 0 ? { byCandidateUnit } : {}),
  };
}

// ─── Anti-drift invariant ─────────────────────────────────────────────────────

/** Reconstruction tolerance — the waterfall is exact by construction of the
 *  `uncertainty` residual, so any drift beyond float noise is a real bug. */
export const LEDGER_RECONSTRUCT_EPSILON = 1e-6;

/**
 * Assert the ledger reconstructs: for every national candidate,
 * `baseline + Σ voteDelta === finalVotes`, and `finalVotes` equals the engine's
 * stored national total. Throws on drift. Unit rows are checked the same way
 * when present.
 */
export function assertLedgerReconstructs(
  ledger: FactorLedgerSnapshot,
  engineNationalVotes: Record<string, number>
): void {
  for (const cand of ledger.byCandidateNational) {
    let sum = cand.nominalWeight;
    for (const f of cand.factors) sum += f.voteDelta;
    if (Math.abs(sum - cand.finalVotes) > LEDGER_RECONSTRUCT_EPSILON) {
      throw new Error(
        `factorLedger drift: candidate ${cand.candidateId} reconstructs to ${sum} but finalVotes is ${cand.finalVotes}`
      );
    }
    const engine = engineNationalVotes[cand.candidateId];
    if (engine === undefined || cand.finalVotes !== engine) {
      throw new Error(
        `factorLedger drift: candidate ${cand.candidateId} finalVotes ${cand.finalVotes} != engine ${engine}`
      );
    }
  }

  for (const unit of ledger.byCandidateUnit ?? []) {
    let sum = unit.nominalWeight;
    for (const f of unit.factors) sum += f.voteDelta;
    if (Math.abs(sum - unit.finalVotes) > LEDGER_RECONSTRUCT_EPSILON) {
      throw new Error(
        `factorLedger drift: unit ${unit.unitId} candidate ${unit.candidateId} reconstructs to ${sum} but finalVotes is ${unit.finalVotes}`
      );
    }
  }
}
