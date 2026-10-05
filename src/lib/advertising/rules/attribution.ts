/**
 * Portable attribution rules for advertising settlement (issue #2235).
 *
 * Rules zone: plain data in, plain data out. No database, clock, randomness,
 * environment, or network.
 *
 * Attribution partitions the buyer's ALREADY-SETTLED marketing spend: the
 * corporation turn owns every cash movement, this module only decides how
 * much of that spend each active agreement covers and what it was worth.
 * Totals always reconcile: contracted + spot == settled, and effective
 * delivery never exceeds settled x (1 + AD_MAX_COVERAGE_BONUS).
 *
 * Delivery semantics:
 * - A supplier that delivered nothing covers nothing: its attributed spend
 *   has zero efficacy and (in cash, which this module does not move) no
 *   receipt, because the turn routes nothing to a zero-delivery seller.
 * - Covered contracted spend earns the overlap efficacy factor.
 * - Contracted spend beyond the supplier's delivery, and all unallocated
 *   (spot) spend, are neutral (x1): the advertising ran, just untargeted.
 */
import { AD_AGREEMENT_BUDGET_BPS } from "../types";
import { AD_MAX_COVERAGE_BONUS, efficacyFactorForOverlap } from "./coverage";

function toNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toShareBps(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(AD_AGREEMENT_BUDGET_BPS, Math.floor(value)));
}

export interface AttributionAgreementInput {
  supplierCorpId: string;
  allocationShareBps: number;
}

export interface AttributionLine {
  supplierCorpId: string;
  allocationShareBps: number;
  overlap: number;
  coveredSpendAnchor: number;
  effectiveAnchor: number;
}

export interface AttributeBuyerSpendArgs {
  /** Marketing cash the turn already settled for this buyer, anchor basis. */
  settledSpendAnchor: number;
  /** False when no supplier delivered advertising: efficacy is zero. */
  deliveryExists: boolean;
  /** Active agreements settling this turn. */
  agreements: readonly AttributionAgreementInput[];
  /**
   * Fraction of each supplier's total contracted claims its delivery covers,
   * in [0, 1]. Zero when the supplier delivered nothing. Computed across ALL
   * buyers by aggregateContractedClaims before attributing any single buyer.
   */
  coverFractionBySupplier: ReadonlyMap<string, number>;
  /** Whether each contracted supplier delivered anything at all this turn. */
  deliveredBySupplier: ReadonlyMap<string, boolean>;
  /** Revenue-weighted coverage overlap per supplier, 0-1. */
  overlapBySupplier: ReadonlyMap<string, number>;
}

export interface AttributeBuyerSpendResult {
  settledSpendAnchor: number;
  contractedSpendAnchor: number;
  spotSpendAnchor: number;
  effectiveAnchor: number;
  /** True when active shares exceeded the budget and were scaled down. */
  normalized: boolean;
  lines: AttributionLine[];
}

export interface ContractedClaim {
  buyerCorpId: string;
  supplierCorpId: string;
  claimedAnchor: number;
}

/**
 * Aggregate every buyer's contracted claims per supplier so delivery can be
 * apportioned fairly: each buyer covers the same fraction of its claim.
 */
export function aggregateContractedClaims(
  buyers: ReadonlyArray<{
    buyerCorpId: string;
    settledSpendAnchor: number;
    agreements: readonly AttributionAgreementInput[];
  }>
): Map<string, ContractedClaim[]> {
  const bySupplier = new Map<string, ContractedClaim[]>();
  for (const buyer of buyers) {
    const settled = toNonNegative(buyer.settledSpendAnchor);
    if (!(settled > 0)) continue;
    const shares = normalizeShares(buyer.agreements);
    for (const agreement of shares) {
      const claimed = (settled * agreement.allocationShareBps) / AD_AGREEMENT_BUDGET_BPS;
      if (!(claimed > 0)) continue;
      const list = bySupplier.get(agreement.supplierCorpId) ?? [];
      list.push({
        buyerCorpId: buyer.buyerCorpId,
        supplierCorpId: agreement.supplierCorpId,
        claimedAnchor: claimed,
      });
      bySupplier.set(agreement.supplierCorpId, list);
    }
  }
  return bySupplier;
}

/**
 * Scale active shares down proportionally when they oversubscribe the
 * buyer's budget. This is the compensating design for concurrent accepts:
 * the API rejects oversubscription it can see, and settlement clamps what it
 * cannot, so allocations always partition the budget.
 */
export function normalizeShares(
  agreements: readonly AttributionAgreementInput[]
): AttributionAgreementInput[] {
  const cleaned = agreements
    .filter((a) => typeof a.supplierCorpId === "string" && a.supplierCorpId.length > 0)
    .map((a) => ({
      supplierCorpId: a.supplierCorpId,
      allocationShareBps: toShareBps(a.allocationShareBps),
    }))
    .filter((a) => a.allocationShareBps > 0);
  const total = cleaned.reduce((sum, a) => sum + a.allocationShareBps, 0);
  if (total <= AD_AGREEMENT_BUDGET_BPS) return cleaned;
  const scale = AD_AGREEMENT_BUDGET_BPS / total;
  let assigned = 0;
  const scaled = cleaned.map((a, index) => {
    if (index === cleaned.length - 1) {
      return { ...a, allocationShareBps: AD_AGREEMENT_BUDGET_BPS - assigned };
    }
    const share = Math.floor(a.allocationShareBps * scale);
    assigned += share;
    return { ...a, allocationShareBps: share };
  });
  return scaled.filter((a) => a.allocationShareBps > 0);
}

/** Delivery cover fraction per supplier from aggregate claims. */
export function coverFractions(
  claimsBySupplier: ReadonlyMap<string, ContractedClaim[]>,
  deliveredAnchorBySupplier: ReadonlyMap<string, number>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [supplierCorpId, claims] of claimsBySupplier) {
    const claimed = claims.reduce((sum, c) => sum + c.claimedAnchor, 0);
    const delivered = toNonNegative(deliveredAnchorBySupplier.get(supplierCorpId));
    if (!(claimed > 0)) {
      out.set(supplierCorpId, 1);
    } else if (!(delivered > 0)) {
      out.set(supplierCorpId, 0);
    } else {
      out.set(supplierCorpId, Math.min(1, delivered / claimed));
    }
  }
  return out;
}

const ZERO = {
  settledSpendAnchor: 0,
  contractedSpendAnchor: 0,
  spotSpendAnchor: 0,
  effectiveAnchor: 0,
  normalized: false,
  lines: [],
} as const;

/**
 * Partition one buyer's settled spend across its agreements plus spot, and
 * value the effective delivered advertising. Pure and deterministic: the
 * same inputs always produce the same outputs, so turn replays are safe.
 */
export function attributeBuyerSpend(args: AttributeBuyerSpendArgs): AttributeBuyerSpendResult {
  const settled = toNonNegative(args.settledSpendAnchor);
  if (!(settled > 0) || args.deliveryExists !== true) return { ...ZERO, lines: [] };

  const shares = normalizeShares(args.agreements);
  const rawTotal = args.agreements
    .map((a) => toShareBps(a.allocationShareBps))
    .reduce((sum, s) => sum + s, 0);
  const normalized = rawTotal > AD_AGREEMENT_BUDGET_BPS;

  let contracted = 0;
  let effective = 0;
  const lines: AttributionLine[] = [];
  for (const agreement of shares) {
    const spend = (settled * agreement.allocationShareBps) / AD_AGREEMENT_BUDGET_BPS;
    const coverFraction = args.coverFractionBySupplier.get(agreement.supplierCorpId) ?? 0;
    const delivered = args.deliveredBySupplier.get(agreement.supplierCorpId) === true;
    const clampedCover = delivered ? Math.min(1, Math.max(0, coverFraction)) : 0;
    const covered = spend * clampedCover;
    const uncovered = spend - covered;
    const overlap =
      typeof args.overlapBySupplier.get(agreement.supplierCorpId) === "number"
        ? Math.min(1, Math.max(0, args.overlapBySupplier.get(agreement.supplierCorpId)!))
        : 0;
    // No delivery means no efficacy on the whole attributed line. Delivered
    // but uncovered spend (shortfall beyond the supplier's book, or states
    // outside its coverage) is neutral: it still ran as advertising.
    const lineEffective = delivered
      ? covered * efficacyFactorForOverlap(overlap) + uncovered * 1
      : 0;
    contracted += spend;
    effective += lineEffective;
    lines.push({
      supplierCorpId: agreement.supplierCorpId,
      allocationShareBps: agreement.allocationShareBps,
      overlap,
      coveredSpendAnchor: round2(covered),
      effectiveAnchor: round2(lineEffective),
    });
  }

  const spot = Math.max(0, settled - contracted);
  effective += spot * 1;

  // Hard bound: rounding across lines must never mint efficacy above the cap.
  // Both sides round first so a half-up penny cannot exceed the cap.
  const cap = round2(settled * (1 + AD_MAX_COVERAGE_BONUS));
  effective = Math.min(round2(effective), cap);
  return {
    settledSpendAnchor: round2(settled),
    contractedSpendAnchor: round2(contracted),
    spotSpendAnchor: round2(spot),
    effectiveAnchor: effective,
    normalized,
    lines,
  };
}
