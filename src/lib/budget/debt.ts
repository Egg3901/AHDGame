/**
 * Federal debt accounting — principal, interest, ceiling, ratings.
 *
 * **Currency (v0.2.6):** Every field used here — `debt.principal`,
 * `debt.interestRate`, `debt.ceiling`, `revenue.total`, `spending.total`, `gdp`
 * — is denominated in the owning country's currency. All math is intra-country
 * (principal accumulation, deficit accrual, ceiling comparison, debt-to-GDP),
 * so no FX conversion is needed here. Cross-currency flows (e.g. a JP sovereign
 * bondholder who holds the bond in JPY and lives in a USD-home country) settle
 * through `bonds/sovereign.ts`, which converts bond-currency proceeds/repayments
 * to the issuer's country currency before touching these fields.
 */
import type { Db } from "mongodb";
import type {
  CreditRating,
  FederalBudget,
  DebtCeilingCrisis,
  SovereignRiskAnchor,
} from "@/lib/db/types/budget";
import {
  INVESTOR_CONFIDENCE_BASELINE,
  SOVEREIGN_CONFIDENCE_PREMIUM_MAX,
} from "@/lib/nationalization/constants";
import { IMF_SOVEREIGN_DEFAULT_RATE } from "@/lib/sovereignDefault/constants";

/**
 * Debt/GDP ratio at which a sovereign leaves the B band and degrades to CCC
 * (refs #3236). 250% is far above any healthy world — live prod countries sit
 * well under it — so this only bites in runaway autonomous-world scenarios.
 */
export const EXTREME_DISTRESS_DEBT_TO_GDP = 2.5;

const DEBT_THRESHOLDS = [
  {
    maxRatio: 0.6,
    rating: "AAA" as CreditRating,
    interestRate: 0.02,
    gdpPenalty: 0,
    trustPenalty: 0,
  },
  {
    maxRatio: 0.8,
    rating: "AA" as CreditRating,
    interestRate: 0.025,
    gdpPenalty: 0,
    trustPenalty: 0,
  },
  {
    maxRatio: 1.0,
    rating: "A" as CreditRating,
    interestRate: 0.035,
    gdpPenalty: 0.1,
    trustPenalty: 0,
  },
  {
    maxRatio: 1.2,
    rating: "BBB" as CreditRating,
    interestRate: 0.05,
    gdpPenalty: 0.2,
    trustPenalty: 0,
  },
  {
    maxRatio: 1.5,
    rating: "BB" as CreditRating,
    interestRate: 0.07,
    gdpPenalty: 0.3,
    trustPenalty: 5,
  },
  {
    maxRatio: EXTREME_DISTRESS_DEBT_TO_GDP,
    rating: "B" as CreditRating,
    interestRate: 0.1,
    gdpPenalty: 0.5,
    trustPenalty: 10,
  },
  // Extreme-distress band (refs #3236): sustained debt/GDP beyond 250% drops the
  // sovereign to CCC — the floor the rating type supports (a post-default
  // repudiation also stamps CCC; see sovereignDefault/resolution/repudiate.ts).
  // Deliberately conservative: no live-world country is anywhere near this
  // ratio, so behavior below 250% is byte-identical to the previous ladder.
  {
    maxRatio: Infinity,
    rating: "CCC" as CreditRating,
    interestRate: 0.14,
    gdpPenalty: 0.7,
    trustPenalty: 15,
  },
];

const RATING_REFERENCE_RATIOS: Record<CreditRating, number> = {
  AAA: 0.45,
  AA: 0.7,
  A: 0.9,
  BBB: 1.1,
  BB: 1.35,
  B: 2.0,
  CCC: 3.0,
};

/** Translate live debt/GDP into the common ladder relative to an authored seed. */
export function normalizeDebtToGdpForRisk(
  debtToGdpRatio: number,
  anchor?: SovereignRiskAnchor
): number {
  if (!anchor || anchor.debtToGdpRatio <= 0 || !Number.isFinite(anchor.debtToGdpRatio)) {
    return debtToGdpRatio;
  }
  const reference = RATING_REFERENCE_RATIOS[anchor.creditRating];
  return Math.max(0, (debtToGdpRatio / anchor.debtToGdpRatio) * reference);
}

export function getDebtThreshold(debtToGdpRatio: number, anchor?: SovereignRiskAnchor) {
  const assessedRatio = normalizeDebtToGdpForRisk(debtToGdpRatio, anchor);
  return (
    DEBT_THRESHOLDS.find((t) => assessedRatio <= t.maxRatio) ||
    DEBT_THRESHOLDS[DEBT_THRESHOLDS.length - 1]
  );
}

export function calculateCreditRating(
  debtToGdpRatio: number,
  anchor?: SovereignRiskAnchor
): CreditRating {
  return getDebtThreshold(debtToGdpRatio, anchor).rating;
}

/**
 * Interest rate for a given debt/GDP ratio, capped at the concessional IMF
 * sovereign-facility rate whenever an IMF bailout program is active on the
 * country (refs #3813).
 *
 * The top tier's flat 14% has no ceiling on ratio — by design, since it's
 * meant to price genuine market distress, not to be a stable steady state.
 * The design's escape valve was always the sovereign-default resolution
 * paths, but a bailout only ever bolted on a small IMF facility alongside
 * the untouched legacy debt, which kept accruing at the punitive tier rate
 * forever (the actual #3813 spiral). A real IMF program's whole point is
 * cheaper financing than the market will offer — the tier rate should never
 * outrank the program rate while one is in force.
 */
export function calculateInterestRate(
  debtToGdpRatio: number,
  imfBailoutActive?: boolean,
  anchor?: SovereignRiskAnchor
): number {
  const ladderRate = getDebtThreshold(debtToGdpRatio, anchor).interestRate;
  const tierRate = anchor
    ? anchor.interestRate *
      (ladderRate / getDebtThreshold(RATING_REFERENCE_RATIOS[anchor.creditRating]).interestRate)
    : ladderRate;
  return imfBailoutActive ? Math.min(tierRate, IMF_SOVEREIGN_DEFAULT_RATE) : tierRate;
}

/**
 * Sovereign interest-rate premium (decimal) from low investor confidence
 * (spec §12.4 feed 2). 0 at/above baseline; rises to SOVEREIGN_CONFIDENCE_PREMIUM_MAX
 * at confidence 0 — expropriation fear makes the government's own borrowing pricier.
 */
export function getSovereignConfidencePremium(
  investorConfidence: number | null | undefined
): number {
  if (investorConfidence == null || !Number.isFinite(investorConfidence)) return 0;
  if (investorConfidence >= INVESTOR_CONFIDENCE_BASELINE) return 0;
  const below = INVESTOR_CONFIDENCE_BASELINE - Math.max(0, investorConfidence);
  return SOVEREIGN_CONFIDENCE_PREMIUM_MAX * (below / INVESTOR_CONFIDENCE_BASELINE);
}

export async function processAnnualDebt(
  db: Db,
  federalBudget: FederalBudget,
  nationalGDP: number
): Promise<{
  newPrincipal: number;
  interestPayment: number;
  debtToGdpRatio: number;
  creditRating: CreditRating;
  interestRate: number;
  ceilingExceeded: boolean;
}> {
  // The per-turn treasury engine (processTreasuryTurn) owns deficit/surplus
  // accumulation continuously; the annual rollover no longer jumps principal by
  // the deficit. It just derives the debt stock from the signed treasury balance
  // (legacy docs without one fall back to −principal, i.e. unchanged).
  const balance = federalBudget.treasuryBalance ?? -federalBudget.debt.principal;
  const newPrincipal = Math.max(0, -balance);
  const interestPayment = newPrincipal * federalBudget.debt.interestRate;

  const debtToGdpRatio = newPrincipal / nationalGDP;
  const creditRating = calculateCreditRating(debtToGdpRatio, federalBudget.sovereignRiskAnchor);
  // Low investor confidence adds a sovereign risk premium (spec §12.4 feed 2).
  const interestRate =
    calculateInterestRate(
      debtToGdpRatio,
      federalBudget.imfSovereignBailoutActive,
      federalBudget.sovereignRiskAnchor
    ) + getSovereignConfidencePremium(federalBudget.investorConfidence);
  const ceilingExceeded = newPrincipal > federalBudget.debt.ceiling;

  return {
    newPrincipal,
    interestPayment,
    debtToGdpRatio,
    creditRating,
    interestRate,
    ceilingExceeded,
  };
}

export async function triggerDebtCeilingCrisis(db: Db, fiscalYear: number): Promise<void> {
  await db.collection<DebtCeilingCrisis>("gameState").updateOne(
    { _id: "debt_ceiling_crisis" },
    {
      $set: {
        active: true,
        triggeredAt: new Date(),
        triggeredYear: fiscalYear,
        turnsElapsed: 0,
        resolved: false,
      },
    },
    { upsert: true }
  );
}

export async function resolveDebtCeilingCrisis(db: Db): Promise<void> {
  await db.collection<DebtCeilingCrisis>("gameState").updateOne(
    { _id: "debt_ceiling_crisis" },
    {
      $set: {
        active: false,
        resolved: true,
        resolvedAt: new Date(),
      },
    }
  );
}

export async function checkDebtCeilingCrisis(db: Db): Promise<DebtCeilingCrisis | null> {
  return db
    .collection<DebtCeilingCrisis>("gameState")
    .findOne({ _id: "debt_ceiling_crisis", active: true });
}

export async function incrementCrisisTurns(db: Db): Promise<number> {
  const result = await db
    .collection<DebtCeilingCrisis>("gameState")
    .findOneAndUpdate(
      { _id: "debt_ceiling_crisis", active: true },
      { $inc: { turnsElapsed: 1 } },
      { returnDocument: "after" }
    );
  return result?.turnsElapsed || 0;
}
