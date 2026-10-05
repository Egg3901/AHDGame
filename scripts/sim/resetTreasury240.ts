/** Headless 1991 treasury stress using the same pure settlement as the reset shell. */
import {
  reconcileGrantTransfer,
  settleNationalTreasury,
  settleRegionalTreasury,
  type NationalTreasuryState,
  type RegionalTreasuryState,
} from "../../src/lib/resetFinance/rules/settlement";
import { openingFiscalBooks1991 } from "../../src/lib/resetFinance/opening1991";

type Country = "US" | "UK" | "JP";
type Scenario = "unchanged" | "receipt_shock" | "unfunded";

/** Rebuilt from the current 1991 seed books and reviewed correction ledger. */
export const OPENING = openingFiscalBooks1991();

export interface ResetTreasuryRun {
  country: Country;
  scenario: Scenario;
  turns: number;
  finalDebt: number;
  finalNationalArrears: number;
  finalRegionalArrears: number;
  peakNationalArrears: number;
  firstDebtCeilingCrossing: number | null;
  firstUSCrisisRollover: number | null;
  grantMismatch: number;
  maximumAccountingResidual: number;
}

const arrearsTotal = (state: NationalTreasuryState): number =>
  Object.values(state.arrears).reduce((sum, value) => sum + value, 0);

export function runResetTreasury240(
  country: Country,
  scenario: Scenario,
  annualLawDelta: number | ((turn: number) => number) = 0
): ResetTreasuryRun {
  if (typeof annualLawDelta === "number" && !Number.isFinite(annualLawDelta)) {
    throw new Error("Invalid annual law delta");
  }
  const seed = OPENING[country];
  let national: NationalTreasuryState = {
    cash: 0,
    debt: seed.debt,
    debtCeiling: seed.debtCeiling,
    emergencyAdvance: 0,
    arrears: { interest: 0, mandatory: 0, grants: 0, existing: 0, new: 0 },
  };
  let regional: RegionalTreasuryState = { cash: 0, arrears: 0 };
  let peakNationalArrears = 0;
  let firstDebtCeilingCrossing: number | null = null;
  let firstUSCrisisRollover: number | null = null;
  let grantMismatch = 0;
  let maximumAccountingResidual = 0;
  for (let turn = 1; turn <= 240; turn += 1) {
    const currentLawDelta =
      typeof annualLawDelta === "function" ? annualLawDelta(turn) : annualLawDelta;
    if (!Number.isFinite(currentLawDelta)) throw new Error("Invalid annual law delta");
    const shocked = scenario === "receipt_shock" && turn > 48 && turn <= 96;
    const revenue = (seed.revenue * (shocked ? 0.75 : 1)) / 48;
    const mandatory = ((seed.operating - seed.grants) * 0.5) / 48;
    const existing = ((seed.operating - seed.grants) * 0.5 + Math.min(0, currentLawDelta)) / 48;
    if (existing < 0) throw new Error("Law delta exceeds the modeled existing claim line");
    const grants = seed.grants / 48;
    const newProgram =
      ((scenario === "unfunded" ? seed.operating * 0.12 : 0) + Math.max(0, currentLawDelta)) / 48;
    const projectedDue =
      (national.debt * seed.interestRate) / 48 +
      mandatory +
      existing +
      grants +
      newProgram +
      arrearsTotal(national);
    // Exercise a quarterly bond shell, not a fictional weekly auto-borrow.
    // In the unfunded case, issuance is deliberately withheld to test arrears.
    const bondProceeds =
      scenario !== "unfunded" && turn % 12 === 0
        ? Math.max(0, projectedDue - national.cash - revenue)
        : 0;
    const settled = settleNationalTreasury(national, {
      revenue,
      bondProceeds,
      bondFaceIssued: bondProceeds,
      bondMaturityCashPaid: 0,
      bondFaceRetired: 0,
      annualInterestRate: seed.interestRate,
      periodsPerYear: 48,
      operatingClaims: { mandatory, grants, existing, new: newProgram },
    });
    national = settled.closing;
    const regionalSettled = settleRegionalTreasury(regional, {
      ownRevenue: (seed.regionalOwnRevenue * (shocked ? 0.75 : 1)) / 48,
      grantReceived: settled.paid.grants,
      protectedClaims: (seed.regionalSpending * 0.5) / 48,
      discretionaryClaims: (seed.regionalSpending * 0.5) / 48,
    });
    regional = regionalSettled.closing;
    grantMismatch += reconcileGrantTransfer(settled, [settled.paid.grants]);
    maximumAccountingResidual = Math.max(
      maximumAccountingResidual,
      Math.abs(settled.accountingResidual),
      Math.abs(regionalSettled.accountingResidual)
    );
    peakNationalArrears = Math.max(peakNationalArrears, arrearsTotal(national));
    if (firstDebtCeilingCrossing === null && settled.ceilingExceeded) {
      firstDebtCeilingCrossing = turn;
    }
    if (
      country === "US" &&
      firstUSCrisisRollover === null &&
      turn % 48 === 40 &&
      settled.ceilingExceeded
    ) {
      firstUSCrisisRollover = turn;
    }
  }
  return {
    country,
    scenario,
    turns: 240,
    finalDebt: national.debt,
    finalNationalArrears: arrearsTotal(national),
    finalRegionalArrears: regional.arrears,
    peakNationalArrears,
    firstDebtCeilingCrossing,
    firstUSCrisisRollover,
    grantMismatch,
    maximumAccountingResidual,
  };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/resetTreasury240.ts")) {
  const runs = (Object.keys(OPENING) as Country[]).flatMap((country) =>
    (["unchanged", "receipt_shock", "unfunded"] as Scenario[]).map((scenario) =>
      runResetTreasury240(country, scenario)
    )
  );
  console.log(
    JSON.stringify({ method: "quarterly-issuance portable-rules stress", runs }, null, 2)
  );
}
