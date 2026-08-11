import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * Per-turn interest on declining balance (annual rate → per-turn).
 */
export function imfPerTurnInterestRate(annualRatePercent: number): number {
  return annualRatePercent / 100 / TURNS_PER_YEAR;
}

/**
 * Level annuity payment per turn for principal `outstanding`, `remainingTurns` left,
 * using per-turn rate `r` (from {@link imfPerTurnInterestRate}).
 */
export function imfLevelPaymentPerTurn(
  outstanding: number,
  r: number,
  remainingTurns: number
): number {
  const n = Math.max(1, Math.floor(remainingTurns));
  const P = Math.max(0, outstanding);
  if (P <= 0) return 0;
  if (r <= 0) return P / n;
  const pow = Math.pow(1 + r, n);
  return (P * r * pow) / (pow - 1);
}

export interface ImfPaymentSplit {
  /** Full scheduled annuity before income cap. */
  scheduledPayment: number;
  /** Actual cash this turn (₳) after cap. */
  actualPayment: number;
  interestPortion: number;
  principalPortion: number;
  /** Interest not covered when capped — capitalized onto principal. */
  interestShortfall: number;
  newPrincipal: number;
  newRemainingTurns: number;
}

const PRINCIPAL_EPS = 1e-6;

/**
 * Computes IMF facility cash flow for one turn. Unpaid interest (when the income cap binds)
 * is **capitalized** into principal; amortization horizon only advances when there was no
 * interest shortfall.
 */
export function computeImfFacilityPaymentTurn(params: {
  principalOutstanding: number;
  annualRatePercent: number;
  remainingTurns: number;
  /** Per-turn operating income (₳) — same basis as corporation turn `income`. */
  turnIncome: number;
  incomeCapFraction: number;
}): ImfPaymentSplit {
  const { principalOutstanding, annualRatePercent, remainingTurns, turnIncome, incomeCapFraction } =
    params;

  const r = imfPerTurnInterestRate(annualRatePercent);
  const n = Math.max(1, Math.floor(remainingTurns));
  const P = Math.max(0, principalOutstanding);

  if (P <= PRINCIPAL_EPS) {
    return {
      scheduledPayment: 0,
      actualPayment: 0,
      interestPortion: 0,
      principalPortion: 0,
      interestShortfall: 0,
      newPrincipal: 0,
      newRemainingTurns: 0,
    };
  }

  const scheduledPayment = imfLevelPaymentPerTurn(P, r, n);
  const interestDue = P * r;
  const incomeCap = Math.max(0, turnIncome) * incomeCapFraction;
  const actualPayment = Math.min(scheduledPayment, incomeCap);

  const interestPaid = Math.min(actualPayment, interestDue);
  const principalPaid = actualPayment - interestPaid;
  const interestShortfall = interestDue - interestPaid;

  const newPrincipal = Math.max(0, P - principalPaid + interestShortfall);

  let newRemainingTurns = n;
  if (interestShortfall > 1e-9) {
    // Capped: do not advance amortization clock so the borrower can catch up later.
    newRemainingTurns = n;
  } else {
    newRemainingTurns = Math.max(0, n - 1);
    if (newPrincipal <= PRINCIPAL_EPS) {
      newRemainingTurns = 0;
    }
  }

  return {
    scheduledPayment,
    actualPayment,
    interestPortion: interestPaid,
    principalPortion: principalPaid,
    interestShortfall,
    newPrincipal,
    newRemainingTurns,
  };
}

const SIM_MAX_TURNS = 100_000;
const PRINCIPAL_BLOWUP_RATIO = 1.25;

export type ImfPayoffSimulationResult = {
  /** Turns until principal clears, or null if not within SIM_MAX_TURNS. */
  estimatedTurns: number | null;
  /** Principal remaining after simulation (should be ~0 if estimatedTurns set). */
  principalEnd: number;
  outcome: "cleared" | "max_iterations" | "principal_rising";
  /** Set when income cap cannot cover interest — facility grows. */
  warning: string | null;
};

/**
 * Forward-simulate facility payoff using the same rules as {@link computeImfFacilityPaymentTurn}
 * with **constant** turn income (last reported operating income). Use for admin estimates only.
 */
export function simulateImfFacilityPayoffTurns(params: {
  initialPrincipal: number;
  annualRatePercent: number;
  amortizationTurns: number;
  turnIncome: number;
  incomeCapFraction: number;
}): ImfPayoffSimulationResult {
  const { initialPrincipal, annualRatePercent, amortizationTurns, turnIncome, incomeCapFraction } =
    params;

  let P = Math.max(0, initialPrincipal);
  let n = Math.max(1, Math.floor(amortizationTurns));
  const P0 = P;

  if (P <= PRINCIPAL_EPS) {
    return { estimatedTurns: 0, principalEnd: 0, outcome: "cleared", warning: null };
  }

  for (let t = 0; t < SIM_MAX_TURNS; t++) {
    const split = computeImfFacilityPaymentTurn({
      principalOutstanding: P,
      annualRatePercent,
      remainingTurns: n,
      turnIncome,
      incomeCapFraction,
    });
    P = split.newPrincipal;
    n = Math.max(1, split.newRemainingTurns);

    if (P <= PRINCIPAL_EPS) {
      return {
        estimatedTurns: t + 1,
        principalEnd: 0,
        outcome: "cleared",
        warning: null,
      };
    }

    if (P > P0 * PRINCIPAL_BLOWUP_RATIO && t > 48) {
      return {
        estimatedTurns: null,
        principalEnd: P,
        outcome: "principal_rising",
        warning:
          "At this income capture and last reported turn income, interest is not fully covered — principal grows. Raise capture % or wait for higher operating income.",
      };
    }
  }

  return {
    estimatedTurns: null,
    principalEnd: P,
    outcome: "max_iterations",
    warning: "Simulation hit the iteration safeguard — verify inputs or income assumptions.",
  };
}
