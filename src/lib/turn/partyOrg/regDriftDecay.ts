import type { AnyBulkWriteOperation, Db, ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  ElectedOfficial,
  OrgRegLedger,
  OrgRegLedgerSource,
  OrgRegMetric,
  StatePartyOrg,
  StateRegistrationPool,
} from "@/lib/db/types";
import { POOL_SENTINEL_PARTY_ID } from "@/lib/db/types";
import {
  regionalExecutiveFromOfficial,
  resolveExecutiveOffice,
} from "@/lib/states/regionalExecutive";
import type { CountryId } from "@/lib/constants/countries";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import {
  HOME_FIELD_DECAY_RELIEF,
  HOME_FIELD_DRIFT_BONUS,
  HOME_FIELD_REG_CAP,
  NON_PARTY_BUCKET_INDEPENDENT_BIAS,
  NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY,
  PASSIVE_REG_DECAY_RATE,
  PASSIVE_REG_DRIFT_RATE,
  REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT,
  REG_LAG_BELOW_ORG_PCT_BY_COUNTRY,
} from "./pacingConstants";
import {
  registrationDecayMultiplier,
  registrationDriftMultiplier,
} from "@/lib/elections/electoralLaws";

/**
 * Politics turn-phase steps 3-4 merged: passive Org→Reg drift then Reg decay
 * with eligibility routing. See `docs/design/political-system-reg-support.md`
 * §8.3 (turn-order contract) and §8.4 (step ordering invariants).
 *
 * Steps run as one phase (not two siblings) for atomic ledger ordering — the
 * design contract specifies drift first then decay, and merging the writes
 * keeps that ordering even under retry.
 *
 * Per-state algorithm:
 *   1. Read all StatePartyOrg rows for the state and the StateRegistrationPool row.
 *      If the pool row is missing (bootstrap from Phase 1.5 not yet landed for
 *      this state), skip — the processor is a no-op until bootstrap runs.
 *   2. Conservation: clamp negative pool buckets and, if the visible sum
 *      (parties + max(0, pool)) is not 100, renormalize so the invariant
 *      holds. Without this, an exhausted pool that went negative is hidden
 *      by the UI (`value > 0` filter) and the legend totals above 100%.
 *   3. Drift: for each party, move regPct toward orgPct by
 *      `min(PASSIVE_REG_DRIFT_RATE, |orgPct - regPct|)`.
 *      The gross party-Reg gain is drawn from Independent+Unregistered first
 *      (without driving either bucket negative); any shortfall is sourced
 *      from parties whose Reg exceeds their own target, in proportion to
 *      that surplus (`sourceFromSurplus`). Drift never mints Reg: if both
 *      the pool and the surplus are exhausted the gain is scaled down.
 *   4. Decay: for each party with regPct > 0, lose `PASSIVE_REG_DECAY_RATE`.
 *      Distribute the lost amount via sqrt(orgPct) weights to parties with
 *      `orgPct >= REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT`. If no eligible party,
 *      route to non-party buckets with bias toward Independent.
 *   5. Apply all writes in one bulkWrite, plus ledger rows.
 *
 * Bootstrap dependency: this processor produces no work until Phase 1.5 /
 * Phase 2 prerequisite seeds `StatePartyOrg.registration` and creates
 * `StateRegistrationPool` rows. Until then it scans, finds nothing to do per
 * state, and exits.
 */

/** Total writes performed across all states this turn. */
export interface RegDriftDecayResult {
  statesScanned: number;
  statesProcessed: number;
  partyRowsUpdated: number;
  poolRowsUpdated: number;
  ledgerRowsWritten: number;
}

interface PartyView {
  rowId: string;
  partyId: string;
  orgPct: number;
  regPct: number;
}

interface PartyDelta {
  partyId: string;
  rowId: string;
  delta: number;
  newReg: number;
}

interface PoolDelta {
  independent: number;
  unregistered: number;
}

/**
 * Drift step: each party's reg moves UP toward `max(0, orgPct − regLagBelowOrg)`
 * by `rate`, bounded by the actual gap. One-directional (up only) — seeded
 * registration is durable and should not decay toward Org on a clock. Downward
 * movement comes from the decay mechanism (PASSIVE_REG_DECAY_RATE) and active
 * political events. The lag reflects real-world friction where registration
 * trails organizational reach. Returns per-party deltas and the residual that
 * must be absorbed by non-party buckets.
 *
 * The 0 floor prevents tiny-Org parties from targeting negative Reg.
 */
export function computeDriftDeltas(
  parties: PartyView[],
  rate: number = PASSIVE_REG_DRIFT_RATE,
  regLagBelowOrg: number = 0
): { partyDeltas: PartyDelta[]; poolResidual: number } {
  let netParty = 0;
  const partyDeltas: PartyDelta[] = [];
  for (const p of parties) {
    const target = Math.max(0, p.orgPct - regLagBelowOrg);
    const gap = target - p.regPct;
    if (gap <= 0) continue;
    const magnitude = Math.min(rate, Math.abs(gap));
    const delta = magnitude;
    netParty += delta;
    partyDeltas.push({ partyId: p.partyId, rowId: p.rowId, delta, newReg: p.regPct + delta });
  }
  // Pool absorbs the negation: if parties gained net X, pool loses X.
  return { partyDeltas, poolResidual: -netParty };
}

/**
 * Decay step: each party with reg > 0 loses `rate` per turn, distributed via
 * `sqrt(orgPct)` weights to eligible parties (≥ `REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT`)
 * or to non-party buckets if none are eligible.
 *
 * Returns the merged set of party deltas (additive on top of drift's deltas)
 * and a pool delta. `parties` is the *post-drift* state — i.e. caller passes
 * `regPct` AFTER drift was applied so decay reads the up-to-date values.
 */
export function computeDecayDeltas(
  parties: PartyView[],
  rate: number = PASSIVE_REG_DECAY_RATE,
  eligibilityOrgPct: number = REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT,
  independentBias: number = NON_PARTY_BUCKET_INDEPENDENT_BIAS,
  /**
   * Governor home-field decay relief: the named party loses
   * `loss × (1 − factor)` instead of the full `loss`. `factor` in [0, 1].
   */
  decayRelief?: { partyId: string; factor: number }
): { partyDeltas: PartyDelta[]; poolDelta: PoolDelta } {
  // Each party loses (min(rate, regPct)), reduced for the governor's party.
  const losses = parties.map((p) => {
    const baseLoss = Math.min(rate, Math.max(0, p.regPct));
    const loss =
      decayRelief && p.partyId === decayRelief.partyId
        ? baseLoss * (1 - decayRelief.factor)
        : baseLoss;
    return { partyId: p.partyId, rowId: p.rowId, loss, orgPct: p.orgPct, regPct: p.regPct };
  });
  const totalLost = losses.reduce((sum, l) => sum + l.loss, 0);

  // Eligible recipients (Org >= threshold). Eligibility is by Org, regardless
  // of whether the party is also losing — a party can simultaneously be both
  // a loser (its decay) and a recipient (its weight catches some lost share).
  const eligible = parties.filter((p) => p.orgPct >= eligibilityOrgPct);
  const totalWeight = eligible.reduce((sum, p) => sum + Math.sqrt(p.orgPct), 0);

  // Build per-party net deltas: -loss + caught share (if eligible).
  const byPartyId = new Map<string, { rowId: string; delta: number; regPct: number }>();
  for (const l of losses) {
    byPartyId.set(l.partyId, { rowId: l.rowId, delta: -l.loss, regPct: l.regPct });
  }
  for (const p of eligible) {
    if (totalWeight === 0) break;
    const share = (Math.sqrt(p.orgPct) / totalWeight) * totalLost;
    const cur = byPartyId.get(p.partyId);
    if (cur) {
      cur.delta += share;
    } else {
      byPartyId.set(p.partyId, { rowId: p.rowId, delta: share, regPct: p.regPct });
    }
  }

  const partyDeltas: PartyDelta[] = [];
  for (const [partyId, info] of byPartyId) {
    if (info.delta === 0) continue;
    partyDeltas.push({
      partyId,
      rowId: info.rowId,
      delta: info.delta,
      newReg: info.regPct + info.delta,
    });
  }

  // If no party is eligible, the entire totalLost goes to non-party buckets
  // with the configured bias. Otherwise the eligible parties absorbed it.
  const poolDelta: PoolDelta = { independent: 0, unregistered: 0 };
  if (eligible.length === 0 && totalLost > 0) {
    const indWeight = independentBias;
    const unregWeight = 1;
    const denom = indWeight + unregWeight;
    poolDelta.independent = (totalLost * indWeight) / denom;
    poolDelta.unregistered = (totalLost * unregWeight) / denom;
  }

  return { partyDeltas, poolDelta };
}

/**
 * Merge two ordered party-delta lists (drift first, decay second). The order
 * matters for ledger emission: drift rows come before decay rows.
 */
function combineDeltas(
  drift: PartyDelta[],
  decay: PartyDelta[]
): { combined: Map<string, PartyDelta>; driftOnly: PartyDelta[]; decayOnly: PartyDelta[] } {
  const combined = new Map<string, PartyDelta>();
  for (const d of drift) {
    combined.set(d.partyId, { ...d });
  }
  for (const d of decay) {
    const cur = combined.get(d.partyId);
    if (cur) {
      cur.delta += d.delta;
      cur.newReg = d.newReg; // decay was computed against post-drift state
    } else {
      combined.set(d.partyId, { ...d });
    }
  }
  return { combined, driftOnly: drift, decayOnly: decay };
}

/** Visible overage large enough to show as >100.0% on a one-decimal legend. */
const OVERAGE_REPAIR_EPSILON = 0.01;

function availablePoolCapacity(independent: number, unregistered: number): number {
  return Math.max(0, independent) + Math.max(0, unregistered);
}

/**
 * Scale positive party deltas so their combined gain does not exceed `capacity`.
 * Mutates `deltas` in place. Returns the (possibly reduced) amount taken from
 * the pool — always <= capacity, always >= 0.
 */
function capPositiveDeltas(deltas: PartyDelta[], capacity: number): number {
  const wanted = deltas.reduce((sum, d) => sum + Math.max(0, d.delta), 0);
  const cap = Math.max(0, capacity);
  if (wanted <= cap) return wanted;
  if (wanted <= 0) return 0;
  const factor = cap / wanted;
  for (const d of deltas) {
    if (d.delta <= 0) continue;
    const scaled = d.delta * factor;
    d.newReg = d.newReg - d.delta + scaled;
    d.delta = scaled;
  }
  return cap;
}

/**
 * Source a drift shortfall from parties whose Reg sits ABOVE their drift
 * target (`max(0, Org − lag)`), in proportion to each party's surplus.
 *
 * Why this exists: drift only ever drew from the non-party pool, and once a
 * state's Independent + Unregistered buckets are exhausted (every US state by
 * live turn ~140) `capPositiveDeltas` scaled every climb to zero. From then on
 * the only mover was the 0.004 pp/turn decay, and registration was frozen
 * against parties that had built real Org. Organised opposition is exactly the
 * "real political cause" seeded registration is meant to respond to, so the
 * shortfall now comes from the over-registered incumbents instead of nowhere.
 *
 * Bounds:
 *   - a party never gives more than its surplus (Reg never drops below target);
 *   - the governor's party contributes at `(1 − relief.factor)` weight, the
 *     same home-field defence its decay already enjoys;
 *   - a state where no party is below target has no shortfall and is untouched,
 *     so an unchallenged Solid South seed stays as durable as before.
 *
 * Returns negative `PartyDelta`s for the sourced parties (their total is
 * `-min(shortfall, Σ surplus)`) so they merge into the drift deltas and ledger
 * exactly like any other drift movement.
 */
export function sourceFromSurplus(
  views: PartyView[],
  climbers: PartyDelta[],
  shortfall: number,
  regLagBelowOrg: number = 0,
  relief?: { partyId: string; factor: number }
): PartyDelta[] {
  if (shortfall <= 0) return [];
  const climbing = new Set(climbers.map((d) => d.partyId));
  const donors = views
    .filter((p) => !climbing.has(p.partyId))
    .map((p) => {
      const target = Math.max(0, p.orgPct - regLagBelowOrg);
      const surplus = p.regPct - target;
      const weight = relief && p.partyId === relief.partyId ? Math.max(0, 1 - relief.factor) : 1;
      return { view: p, surplus, weight, drawn: 0 };
    })
    .filter((d) => d.surplus > 0 && d.weight > 0);
  if (donors.length === 0) return [];

  // Water-fill: distribute by (surplus × weight), cap each donor at its
  // surplus, and re-spread any remainder over the donors still under cap.
  let remaining = Math.min(
    shortfall,
    donors.reduce((sum, d) => sum + d.surplus, 0)
  );
  const EPS = 1e-12;
  while (remaining > EPS) {
    const open = donors.filter((d) => d.surplus - d.drawn > EPS);
    if (open.length === 0) break;
    const totalWeight = open.reduce((sum, d) => sum + (d.surplus - d.drawn) * d.weight, 0);
    if (totalWeight <= 0) break;
    const batch = remaining;
    for (const d of open) {
      const share = (batch * (d.surplus - d.drawn) * d.weight) / totalWeight;
      const take = Math.min(share, d.surplus - d.drawn);
      d.drawn += take;
      remaining -= take;
    }
  }

  return donors
    .filter((d) => d.drawn > 0)
    .map((d) => ({
      partyId: d.view.partyId,
      rowId: d.view.rowId,
      delta: -d.drawn,
      newReg: d.view.regPct - d.drawn,
    }));
}

/**
 * Apply a pool residual without driving either bucket negative.
 * `residual` < 0 takes from the pool (parties gained); `residual` > 0 adds
 * to the pool split by Independent bias. When taking, leftover demand after
 * one bucket empties overflows to the other instead of going negative.
 */
function applyPoolResidual(
  residual: number,
  independent: number,
  unregistered: number,
  independentBias: number
): PoolDelta {
  if (residual === 0) return { independent: 0, unregistered: 0 };
  const indWeight = independentBias;
  const unregWeight = 1;
  const denom = indWeight + unregWeight;

  if (residual > 0) {
    return {
      independent: (residual * indWeight) / denom,
      unregistered: (residual * unregWeight) / denom,
    };
  }

  const want = -residual;
  const availInd = Math.max(0, independent);
  const availUnreg = Math.max(0, unregistered);
  const draw = Math.min(want, availInd + availUnreg);
  if (draw <= 0) return { independent: 0, unregistered: 0 };

  let fromInd = Math.min(availInd, (draw * indWeight) / denom);
  let fromUnreg = Math.min(availUnreg, (draw * unregWeight) / denom);
  let shortfall = draw - fromInd - fromUnreg;
  if (shortfall > 0) {
    const extraInd = Math.min(shortfall, availInd - fromInd);
    fromInd += extraInd;
    shortfall -= extraInd;
    fromUnreg += Math.min(shortfall, availUnreg - fromUnreg);
  }
  return { independent: -fromInd, unregistered: -fromUnreg };
}

/**
 * Restore the 100% pool invariant when the *visible* total (party Reg +
 * non-negative pool buckets) exceeds 100. Negative buckets are treated as 0
 * — they are an accounting artifact of prior overdraw, and the UI hides them
 * (`value > 0`), which is how the legend was able to total above 100%.
 *
 * Deficits (sum < 100) are left alone: some countries seed without a full
 * remainder pool, and existing tests assert conservation of the starting
 * total rather than a force-to-100 rewrite.
 */
function repairOverage(
  parties: PartyView[],
  independent: number,
  unregistered: number
): { partyDeltas: PartyDelta[]; independent: number; unregistered: number } {
  const clampedInd = Math.max(0, independent);
  const clampedUnreg = Math.max(0, unregistered);
  const partySum = parties.reduce((sum, p) => sum + p.regPct, 0);
  const poolSum = clampedInd + clampedUnreg;
  const visible = partySum + poolSum;
  const partyDeltas: PartyDelta[] = [];
  if (visible <= 100 + OVERAGE_REPAIR_EPSILON || partySum <= 0) {
    return { partyDeltas, independent: clampedInd, unregistered: clampedUnreg };
  }
  const targetPartySum = Math.max(0, 100 - poolSum);
  const scale = targetPartySum / partySum;
  for (const p of parties) {
    const newReg = p.regPct * scale;
    const delta = newReg - p.regPct;
    if (delta === 0) continue;
    partyDeltas.push({ partyId: p.partyId, rowId: p.rowId, delta, newReg });
  }
  return { partyDeltas, independent: clampedInd, unregistered: clampedUnreg };
}

interface ProcessStateInput {
  countryId: StatePartyOrg["countryId"];
  stateId: string;
  parties: StatePartyOrg[];
  pool: StateRegistrationPool;
  turn: number;
  now: Date;
  /** The party holding this state's executive + its magnitude band, when any. */
  governor?: { partyId: string; sign: 1 | 2 | 3 } | null;
  /**
   * Enacted registration-access law, -50..+50 (`gameState.registrationAccessBias`).
   * Absent/0 = the neutral regime, byte-identical to the pre-law behaviour.
   */
  registrationAccessBias?: number | null;
}

/**
 * Governor home-field upward Reg drift nudge (pp this turn). Scales with the
 * executive's magnitude band but is clamped so the gov-driven push never lifts
 * Reg above `HOME_FIELD_REG_CAP` — natural Org-target drift still governs the
 * party below the cap; only this bonus contribution is capped.
 */
export function govHomeFieldNudge(postDriftReg: number, sign: number): number {
  const headroom = Math.max(0, HOME_FIELD_REG_CAP - postDriftReg);
  return Math.min(sign * HOME_FIELD_DRIFT_BONUS, headroom);
}

interface ProcessStateOutput {
  partyUpdates: { rowId: string; newReg: number }[];
  poolUpdate: { newIndependent: number; newUnregistered: number };
  ledgerRows: Omit<OrgRegLedger, "_id">[];
}

/** Pure planner — separated from DB writes so it's easy to test. */
export function planStateRegDriftDecay(input: ProcessStateInput): ProcessStateOutput | null {
  // Drift applies to EVERY party with a row, treating an undefined `registration`
  // as 0 (design §4.2.1 / §4.4). This is what lets a party that has built Org
  // but has no seeded Reg lane — e.g. US third parties, which the seed leaves
  // undefined — begin accruing a registered base instead of being skipped
  // forever. The processor only runs for states that already have a
  // `StateRegistrationPool` row, so pool existence (not per-party Reg) is the
  // bootstrap gate; an Org=0 / Reg=0 party simply computes a zero delta and is
  // left untouched.
  const partyViews: PartyView[] = input.parties.map((p) => ({
    rowId: p._id,
    partyId: p.partyId,
    orgPct: p.organization ?? 0,
    regPct: p.registration ?? 0,
  }));
  if (partyViews.length === 0) return null;

  const regLag = REG_LAG_BELOW_ORG_PCT_BY_COUNTRY[input.countryId] ?? 0;
  const independentBias =
    NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY[input.countryId] ??
    NON_PARTY_BUCKET_INDEPENDENT_BIAS;

  // Enacted electoral law scales both passive rates. Expanded registration
  // pulls voters onto the rolls faster and lets fewer lapse; restricted
  // registration does the reverse. Party-neutral by construction: the rates
  // move, the routing does not, so who picks up newly-registered voters is
  // still decided by organization.
  const accessBias = input.registrationAccessBias ?? 0;
  const driftRate = PASSIVE_REG_DRIFT_RATE * registrationDriftMultiplier(accessBias);
  const decayRate = PASSIVE_REG_DECAY_RATE * registrationDecayMultiplier(accessBias);

  // Clamp negative buckets and scale party Reg down when the visible total
  // (what the legend shows after hiding non-positive slices) exceeds 100.
  const repaired = repairOverage(partyViews, input.pool.independent, input.pool.unregistered);
  const viewsAfterRepair: PartyView[] = partyViews.map((p) => {
    const d = repaired.partyDeltas.find((x) => x.partyId === p.partyId);
    return d ? { ...p, regPct: d.newReg } : p;
  });
  const independent = repaired.independent;
  const unregistered = repaired.unregistered;

  const { partyDeltas: drift } = computeDriftDeltas(viewsAfterRepair, driftRate, regLag);

  // Governor home-field: an extra upward Reg drift for the executive's party,
  // capped via `govHomeFieldNudge`. Combined with base drift, the draw is then
  // bounded by remaining pool capacity so the 100% invariant is preserved.
  const gov = input.governor ?? null;
  if (gov) {
    const govDrift = drift.find((d) => d.partyId === gov.partyId);
    if (govDrift) {
      const nudge = govHomeFieldNudge(govDrift.newReg, gov.sign);
      if (nudge > 0) {
        govDrift.delta += nudge;
        govDrift.newReg += nudge;
      }
    }
  }

  // Drift (including home-field) cannot mint registration. The pool is drawn
  // first; whatever Independent + Unregistered cannot cover is sourced from
  // parties holding Reg above their own target (see `sourceFromSurplus`), and
  // only the remainder after both is scaled away.
  const capacity = availablePoolCapacity(independent, unregistered);
  const wanted = drift.reduce((sum, d) => sum + Math.max(0, d.delta), 0);
  const sourced = sourceFromSurplus(
    viewsAfterRepair,
    drift,
    wanted - capacity,
    regLag,
    gov
      ? { partyId: gov.partyId, factor: Math.min(1, gov.sign * HOME_FIELD_DECAY_RELIEF) }
      : undefined
  );
  const fromSurplus = sourced.reduce((sum, d) => sum - d.delta, 0);
  const taken = capPositiveDeltas(drift, capacity + fromSurplus);
  const driftPoolResidual = -Math.min(taken, capacity);
  drift.push(...sourced);

  // Apply drift to in-memory views before computing decay so decay reads
  // post-drift regPct (matches §8.4 invariant: drift before decay).
  const postDriftViews: PartyView[] = viewsAfterRepair.map((p) => {
    const d = drift.find((x) => x.partyId === p.partyId);
    return d ? { ...p, regPct: d.newReg } : p;
  });
  // Governor home-field also relieves the executive party's passive decay.
  const decayRelief = gov
    ? { partyId: gov.partyId, factor: Math.min(1, gov.sign * HOME_FIELD_DECAY_RELIEF) }
    : undefined;
  const { partyDeltas: decay, poolDelta: decayPoolDelta } = computeDecayDeltas(
    postDriftViews,
    decayRate,
    REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT,
    independentBias,
    decayRelief
  );

  const driftPoolDelta = applyPoolResidual(
    driftPoolResidual,
    independent,
    unregistered,
    independentBias
  );

  const newIndependent = Math.max(
    0,
    independent + driftPoolDelta.independent + decayPoolDelta.independent
  );
  const newUnregistered = Math.max(
    0,
    unregistered + driftPoolDelta.unregistered + decayPoolDelta.unregistered
  );

  const { combined: afterDrift } = combineDeltas(repaired.partyDeltas, drift);
  const { combined } = combineDeltas(Array.from(afterDrift.values()), decay);
  const partyUpdates = Array.from(combined.values())
    .filter((d) => d.delta !== 0)
    .map((d) => ({ rowId: d.rowId, newReg: d.newReg }));

  // Build ledger rows. One per non-zero delta per source. Renormalize first
  // so a later drift/decay row's `value` is the post-repair running total.
  const ledgerRows: Omit<OrgRegLedger, "_id">[] = [];
  for (const d of repaired.partyDeltas) {
    if (d.delta === 0) continue;
    ledgerRows.push(makeLedgerRow(input, d.partyId, "reg", d.delta, d.newReg, "renormalize"));
  }
  for (const d of drift) {
    if (d.delta === 0) continue;
    ledgerRows.push(makeLedgerRow(input, d.partyId, "reg", d.delta, d.newReg, "drift"));
  }
  if (driftPoolDelta.independent !== 0) {
    ledgerRows.push(
      makeLedgerRow(
        input,
        POOL_SENTINEL_PARTY_ID,
        "independent",
        driftPoolDelta.independent,
        independent + driftPoolDelta.independent,
        "drift"
      )
    );
  }
  if (driftPoolDelta.unregistered !== 0) {
    ledgerRows.push(
      makeLedgerRow(
        input,
        POOL_SENTINEL_PARTY_ID,
        "unregistered",
        driftPoolDelta.unregistered,
        unregistered + driftPoolDelta.unregistered,
        "drift"
      )
    );
  }
  for (const d of decay) {
    if (d.delta === 0) continue;
    ledgerRows.push(makeLedgerRow(input, d.partyId, "reg", d.delta, d.newReg, "decay"));
  }
  if (decayPoolDelta.independent !== 0) {
    ledgerRows.push(
      makeLedgerRow(
        input,
        POOL_SENTINEL_PARTY_ID,
        "independent",
        decayPoolDelta.independent,
        independent + driftPoolDelta.independent + decayPoolDelta.independent,
        "decay"
      )
    );
  }
  if (decayPoolDelta.unregistered !== 0) {
    ledgerRows.push(
      makeLedgerRow(
        input,
        POOL_SENTINEL_PARTY_ID,
        "unregistered",
        decayPoolDelta.unregistered,
        unregistered + driftPoolDelta.unregistered + decayPoolDelta.unregistered,
        "decay"
      )
    );
  }

  return {
    partyUpdates,
    poolUpdate: { newIndependent, newUnregistered },
    ledgerRows,
  };
}

function makeLedgerRow(
  input: ProcessStateInput,
  partyId: string,
  metric: OrgRegMetric,
  delta: number,
  value: number,
  source: OrgRegLedgerSource
): Omit<OrgRegLedger, "_id"> {
  return {
    turn: input.turn,
    countryId: input.countryId,
    stateId: input.stateId,
    partyId,
    metric,
    delta,
    value,
    source,
    actorId: null as ObjectId | null,
    createdAt: input.now,
  };
}

/**
 * Apply drift + decay across every state with a registration pool row.
 *
 * Idempotent only in the sense that running twice in the same turn would
 * apply the deltas twice — caller (the turn-phase registry) is responsible
 * for invoking once per turn.
 */
export async function processRegDriftDecay(
  currentTurn: number,
  now: Date = new Date(),
  injectedDb?: Db
): Promise<RegDriftDecayResult> {
  const db = injectedDb ?? (await getDb());

  const result: RegDriftDecayResult = {
    statesScanned: 0,
    statesProcessed: 0,
    partyRowsUpdated: 0,
    poolRowsUpdated: 0,
    ledgerRowsWritten: 0,
  };

  const pools = await db
    .collection<StateRegistrationPool>("stateRegistrationPool")
    .find({})
    .toArray();
  result.statesScanned = pools.length;
  if (pools.length === 0) return result;

  // Turn length is constant across the turn — load once for tenure→band math
  // rather than re-reading gameConfig for every state.
  const turnLengthMinutes = await loadTurnLengthMinutes(db);

  // Enacted registration-access law is national and constant across the turn,
  // so it joins the once-per-phase reads rather than being fetched per pool.
  const gs = await db
    .collection<{
      _id: string;
      registrationAccessBias?: number;
      registrationAccessBiasByCountry?: Partial<Record<string, number>>;
    }>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { registrationAccessBias: 1, registrationAccessBiasByCountry: 1 } }
    );
  /**
   * Per country — electoral law is national law. The legacy global field is the
   * fallback so a world written before the map existed still resolves, but a
   * country with its own entry uses only that.
   */
  const accessBiasFor = (countryId: string): number =>
    gs?.registrationAccessBiasByCountry?.[countryId.toUpperCase()] ??
    gs?.registrationAccessBias ??
    0;

  // Batched: this phase used to do ~5 sequential DB round-trips PER pool
  // (statePartyOrg find, regional-executive findOne, statePartyOrg bulkWrite,
  // pool updateOne, ledger insertMany) — ~800+ serial round-trips at ~167
  // pools, the same anti-pattern fixed repeatedly this session, and it scales
  // with states × countries. Now: load all statePartyOrg + all regional
  // executives ONCE, plan every pool in memory, then commit three batched
  // writes (party updates, pool updates, ledger inserts).
  const countryIds = Array.from(new Set(pools.map((p) => p.countryId)));

  const allParties = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId: { $in: countryIds } })
    .toArray();
  const partiesByStateKey = new Map<string, StatePartyOrg[]>();
  for (const row of allParties) {
    const k = `${row.countryId}:${row.stateId}`;
    const list = partiesByStateKey.get(k);
    if (list) list.push(row);
    else partiesByStateKey.set(k, [row]);
  }

  // All regional-executive officials in one query (office types are only
  // "governor" / "ministerPresident"), keyed by country:STATE:officeType with
  // the most-recently-elected winning ties — mirrors getRegionalExecutive's
  // `sort({ electedAt: -1 })` pick.
  const execOfficials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      countryId: { $in: countryIds },
      officeType: { $in: ["governor", "ministerPresident"] },
    })
    .toArray();
  const officialByKey = new Map<string, ElectedOfficial>();
  for (const o of execOfficials) {
    const k = `${o.countryId}:${(o.state ?? "").toUpperCase()}:${o.officeType}`;
    const prev = officialByKey.get(k);
    if (
      !prev ||
      (o.electedAt &&
        (!prev.electedAt || new Date(o.electedAt).getTime() > new Date(prev.electedAt).getTime()))
    ) {
      officialByKey.set(k, o);
    }
  }

  const partyOps: AnyBulkWriteOperation<StatePartyOrg>[] = [];
  const poolOps: AnyBulkWriteOperation<StateRegistrationPool>[] = [];
  const ledgerRows: OrgRegLedger[] = [];

  for (const pool of pools) {
    const parties = partiesByStateKey.get(`${pool.countryId}:${pool.stateId}`) ?? [];

    const office = resolveExecutiveOffice(pool.countryId as CountryId, pool.stateId);
    const official = office
      ? officialByKey.get(`${pool.countryId}:${pool.stateId.toUpperCase()}:${office.officeType}`)
      : undefined;
    const executive = regionalExecutiveFromOfficial(
      pool.countryId as CountryId,
      pool.stateId,
      official,
      now,
      turnLengthMinutes
    );

    const planned = planStateRegDriftDecay({
      countryId: pool.countryId,
      stateId: pool.stateId,
      parties,
      pool,
      turn: currentTurn,
      now,
      governor: executive ? { partyId: executive.partyId, sign: executive.sign } : null,
      registrationAccessBias: accessBiasFor(pool.countryId),
    });
    if (!planned) continue;

    result.statesProcessed += 1;

    for (const u of planned.partyUpdates) {
      partyOps.push({
        updateOne: {
          filter: { _id: u.rowId },
          update: { $set: { registration: u.newReg, updatedAt: now } },
        },
      });
    }
    result.partyRowsUpdated += planned.partyUpdates.length;

    poolOps.push({
      updateOne: {
        filter: { _id: pool._id },
        update: {
          $set: {
            independent: planned.poolUpdate.newIndependent,
            unregistered: planned.poolUpdate.newUnregistered,
            lastUpdatedTurn: currentTurn,
            updatedAt: now,
          },
        },
      },
    });
    result.poolRowsUpdated += 1;

    for (const r of planned.ledgerRows) ledgerRows.push({ ...r } as OrgRegLedger);
  }

  if (partyOps.length > 0) {
    await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(partyOps);
  }
  if (poolOps.length > 0) {
    await db.collection<StateRegistrationPool>("stateRegistrationPool").bulkWrite(poolOps);
  }
  if (ledgerRows.length > 0) {
    await db.collection<OrgRegLedger>("orgRegLedger").insertMany(ledgerRows);
    result.ledgerRowsWritten += ledgerRows.length;
  }

  return result;
}
