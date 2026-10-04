/**
 * Controlled corporate maturity-liquidity and cashless refinancing sensitivity.
 * Uses production scoring and quote functions with authored synthetic balance sheets.
 */
import { ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  calculateCreditScore,
  CORPORATE_CREDIT_MATURITY_HORIZON_TURNS,
  getBondCouponRate,
} from "@/lib/constants/bonds";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { computeCorporateCreditAtTurn } from "@/lib/bonds/corporateCredit";
import { previewRefinanceIssuance } from "@/lib/bonds/corporateBondDefault";
import { assessMaturityLiquidity } from "@/lib/bonds/rules/maturityLiquidity";

const corporationId = new ObjectId("000000000000000000000001");
const fx = new Map<CurrencyCode, number>();
const TURN = 100;
const MILLION = 1_000_000;

function bond(principal: number, maturityTurn: number, defaulted = false): Bond {
  return {
    _id: new ObjectId("000000000000000000000002"),
    corporationId,
    issuerType: "corporation",
    faceValue: 1000,
    couponRate: 5,
    maturityTurns: 48,
    issuedAtTurn: maturityTurn - 48,
    maturityTurn,
    marketPrice: 1,
    totalIssued: principal * MILLION,
    publicFloat: 0,
    holders: [],
    defaulted,
    defaultedAtTurn: defaulted ? TURN : null,
    matured: false,
    createdAt: new Date("2000-01-01T00:00:00Z"),
    updatedAt: new Date("2000-01-01T00:00:00Z"),
  };
}

const scenarios = [
  { name: "distant", cash: 20, income: 10, bonds: [bond(100, 125)] },
  { name: "next-turn-cliff", cash: 20, income: 10, bonds: [bond(100, 101)] },
  { name: "due-now-cliff", cash: 20, income: 10, bonds: [bond(100, 100)] },
  { name: "overdue-cliff", cash: 20, income: 10, bonds: [bond(100, 99)] },
  { name: "cumulative-cliffs", cash: 70, income: 10, bonds: [bond(60, 101), bond(60, 102)] },
  { name: "covered", cash: 200, income: 10, bonds: [bond(100, 101)] },
  { name: "operating-loss", cash: 20, income: -10, bonds: [bond(100, 124)] },
  { name: "live-default-floor", cash: 20, income: 10, bonds: [bond(100, 99, true)], penalty: 196 },
  { name: "recovered", cash: 200, income: 10, bonds: [bond(100, 101)], penalty: 100 },
];

const cases = scenarios.map((scenario) => {
  const result = computeCorporateCreditAtTurn({
    corporationId,
    bonds: scenario.bonds,
    liquidCapitalAnchor: scenario.cash * MILLION,
    incomePerTurn: (scenario.income * MILLION) / TURNS_PER_YEAR,
    sectorNpv: 100 * MILLION,
    currentTurn: TURN,
    bondDefaultCreditPenaltyUntilTurn: scenario.penalty ?? null,
    fxByCurrency: fx,
  });
  // Omitting maturity liquidity reproduces the pre-change scoring algorithm.
  const legacy = calculateCreditScore(
    scenario.cash * MILLION,
    result.totalDebt,
    scenario.income * MILLION,
    result.annualCouponObligations,
    result.totalEquity,
    { bondDefaultCreditPenaltyActive: (scenario.penalty ?? TURN) > TURN }
  );
  return {
    name: scenario.name,
    cashAnchor: scenario.cash * MILLION,
    annualIncomeAnchor: scenario.income * MILLION,
    totalDebtAnchor: result.totalDebt,
    legacy,
    candidate: result.creditRating,
    legacyNewBorrowingCouponPct: getBondCouponRate(5, legacy.rating, 48),
    candidateNewBorrowingCouponPct: getBondCouponRate(5, result.creditRating.rating, 48),
    maturityLiquidity: result.maturityLiquidity,
  };
});

// The quote currently accepts a corporation document but does not read it.
// This deliberately synthetic fixture contains no real corporation data.
const syntheticCorporation = { _id: corporationId } as Corporation;
const refinancing = [
  { name: "healthy-cashless-roll", cash: 200, income: 100, livePrincipal: 0 },
  { name: "unfunded-cashless-roll", cash: 20, income: 10, livePrincipal: 0 },
  { name: "cashless-roll-with-other-near-maturity", cash: 20, income: 10, livePrincipal: 50 },
].map((scenario) => {
  const bonds = [
    bond(100, 99, true),
    ...(scenario.livePrincipal > 0 ? [bond(scenario.livePrincipal, 101)] : []),
  ];
  const quote = previewRefinanceIssuance({
    corporation: syntheticCorporation,
    liquidCapitalAnchor: scenario.cash * MILLION,
    allNonMaturedBonds: bonds,
    actualFaceAnchor: 100 * MILLION,
    sectorNpv: 100 * MILLION,
    annualIncome: scenario.income * MILLION,
    primeRate: 5,
    currentTurn: TURN,
    fxByCurrency: fx,
    maturityTurns: 48,
  });
  const legacy = calculateCreditScore(
    scenario.cash * MILLION,
    (100 + scenario.livePrincipal) * MILLION,
    scenario.income * MILLION,
    ((100 + scenario.livePrincipal) * MILLION * 5) / 100,
    (scenario.cash + 100) * MILLION
  );
  return {
    name: scenario.name,
    replacementFaceAnchor: 100 * MILLION,
    proceedsAnchor: 0,
    otherNearMaturityPrincipalAnchor: scenario.livePrincipal * MILLION,
    legacyRating: legacy,
    legacyCouponPct: getBondCouponRate(5, legacy.rating, 48),
    candidateQuote: quote,
  };
});

const horizonSensitivity = [12, 24, 48].map((horizonTurns) => ({
  horizonTurns,
  forecast: assessMaturityLiquidity({
    obligations: [{ principalAnchor: 100 * MILLION, maturityTurn: 124 }],
    liquidCapitalAnchor: 20 * MILLION,
    incomePerTurn: (10 * MILLION) / TURNS_PER_YEAR,
    annualCouponObligations: 5 * MILLION,
    currentTurn: TURN,
    horizonTurns,
    turnsPerYear: TURNS_PER_YEAR,
  }),
}));

const cliff = cases.find((scenario) => scenario.name === "next-turn-cliff")!;
if (
  cliff.legacy.rating !== "A" ||
  cliff.legacy.compositeScore !== 69 ||
  cliff.candidate.rating !== "BBB" ||
  cliff.candidate.compositeScore !== 53
) {
  throw new Error("The source-derived maturity counterexample changed");
}
for (const name of ["distant", "covered", "live-default-floor", "recovered"]) {
  const scenario = cases.find((entry) => entry.name === name)!;
  if (JSON.stringify(scenario.legacy) !== JSON.stringify(scenario.candidate)) {
    throw new Error(`Legacy compatibility changed in ${name}`);
  }
}
if (
  refinancing.slice(0, 2).some((entry) => entry.legacyCouponPct !== entry.candidateQuote.couponRate)
) {
  throw new Error(
    "A cashless roll treated replacement principal as cash or an imminent old maturity"
  );
}

console.log(
  JSON.stringify(
    {
      baseline: "ad4089c995be12873da90a3941ece949b8e1c873",
      model: "Controlled production scoring and refinancing quotes, not a world simulation",
      assumptions: {
        currentTurn: TURN,
        turnsPerGameYear: TURNS_PER_YEAR,
        maturityHorizonTurns: CORPORATE_CREDIT_MATURITY_HORIZON_TURNS,
        horizonCalibration:
          "Provisional authored half-year horizon; requires pinned-world qualification",
        primeRatePct: 5,
        sectorNpvAnchor: 100 * MILLION,
        smoothing:
          "Disabled for the matrix; turn smoothing and persisted displays have focused regressions",
        income: "Fixed per-turn operating estimate, before corporate overhead and taxes",
        coupons: "Current annual coupon run rate reserved through each cumulative maturity date",
        refinancing:
          "Forced roll is cashless; optional future borrowing contributes no forecast cash",
      },
      cases,
      refinancing,
      horizonSensitivity,
      limitations: [
        "Scenario counts are not an observed rating distribution or default prevalence.",
        "A forecast cash gap does not by itself trigger the actual insolvency/default detector.",
        "No endogenous revenue, asset sales, optional investor funding or repayment decisions are simulated.",
        "Pinned sandbox worlds are still required for rating distributions, refinancing capacity and default incidence.",
      ],
    },
    null,
    2
  )
);
