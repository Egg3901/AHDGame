/**
 * Reset treasury settlement. Cash, debt, arrears, and regional grants are
 * accounted for once; an internal grant is not a second national expense.
 * The caller supplies actual bond proceeds and all lawful claims.
 */

export const NATIONAL_CLAIM_PRIORITY = [
  "interest",
  "mandatory",
  "grants",
  "existing",
  "new",
] as const;

export type NationalClaimCategory = (typeof NATIONAL_CLAIM_PRIORITY)[number];
export type NationalClaims = Record<NationalClaimCategory, number>;

export interface NationalTreasuryState {
  cash: number;
  debt: number;
  debtCeiling: number;
  /** Bridge liability created only when already-paid bond service lacks cash. */
  emergencyAdvance: number;
  arrears: NationalClaims;
}

export interface NationalTurnInput {
  revenue: number;
  annualInterestRate: number;
  periodsPerYear: number;
  operatingClaims: Omit<NationalClaims, "interest">;
  /** Proceeds issued by the existing bond shell, not inferred by this rule. */
  bondProceeds: number;
  /** Face added to debt. A later placement can raise different cash than face. */
  bondFaceIssued: number;
  /** Actual maturity payout, including face already written down by a haircut. */
  bondMaturityCashPaid: number;
  /** Debt stock retired by the bond shell, which can be below the payout. */
  bondFaceRetired: number;
  /** Actual coupon paid by the bond shell. Omit only for forecast runs. */
  bondCouponCashPaid?: number;
  /**
   * Enacted operating appropriations are backed by the signed national budget
   * balance. When true, a cash shortfall is deficit financing there rather
   * than an unpaid Cabinet obligation in this disbursement ledger.
   */
  fundOperatingAppropriations?: boolean;
}

export interface NationalTurnSettlement {
  closing: NationalTreasuryState;
  due: NationalClaims;
  paid: NationalClaims;
  interestDue: number;
  maturityOutlay: number;
  emergencyAdvanceDrawn: number;
  appropriationFinancing: number;
  externalOutlay: number;
  grantTransfer: number;
  totalPaid: number;
  requestedFinancing: number;
  ceilingExceeded: boolean;
  accountingResidual: number;
}

export interface RegionalTreasuryState {
  cash: number;
  arrears: number;
}

export interface RegionalTurnInput {
  ownRevenue: number;
  /** Must equal an allocated share of the national paid.grants line. */
  grantReceived: number;
  protectedClaims: number;
  discretionaryClaims: number;
}

export interface RegionalTurnSettlement {
  closing: RegionalTreasuryState;
  protectedPaid: number;
  discretionaryPaid: number;
  arrearsPaid: number;
  newProtectedArrears: number;
  deliveryRatio: number;
  accountingResidual: number;
}

function amount(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and nonnegative`);
  }
  return value;
}

function emptyClaims(): NationalClaims {
  return { interest: 0, mandatory: 0, grants: 0, existing: 0, new: 0 };
}

function sumClaims(claims: NationalClaims): number {
  return NATIONAL_CLAIM_PRIORITY.reduce((sum, category) => sum + claims[category], 0);
}

export function settleNationalTreasury(
  state: NationalTreasuryState,
  input: NationalTurnInput
): NationalTurnSettlement {
  amount(state.cash, "cash");
  amount(state.debt, "debt");
  amount(state.debtCeiling, "debtCeiling");
  amount(state.emergencyAdvance, "emergencyAdvance");
  amount(input.revenue, "revenue");
  amount(input.annualInterestRate, "annualInterestRate");
  amount(input.bondProceeds, "bondProceeds");
  amount(input.bondFaceIssued, "bondFaceIssued");
  amount(input.bondMaturityCashPaid, "bondMaturityCashPaid");
  amount(input.bondFaceRetired, "bondFaceRetired");
  if (input.bondCouponCashPaid !== undefined) {
    amount(input.bondCouponCashPaid, "bondCouponCashPaid");
  }
  if (input.bondFaceRetired > state.debt + input.bondFaceIssued) {
    throw new Error("Bond retirement exceeds outstanding face");
  }
  if (!Number.isInteger(input.periodsPerYear) || input.periodsPerYear < 1) {
    throw new Error("periodsPerYear must be a positive integer");
  }
  const interestDue =
    input.bondCouponCashPaid ?? (state.debt * input.annualInterestRate) / input.periodsPerYear;
  const due = emptyClaims();
  for (const category of NATIONAL_CLAIM_PRIORITY) {
    const current = category === "interest" ? interestDue : input.operatingClaims[category];
    due[category] =
      amount(state.arrears[category], `arrears.${category}`) + amount(current, category);
  }
  const liquidBeforeBonds = state.cash + input.revenue;
  const liquidAfterIssuance = liquidBeforeBonds + input.bondProceeds;
  const prepaidCoupon = input.bondCouponCashPaid ?? 0;
  const prepaidBonds = input.bondMaturityCashPaid + prepaidCoupon;
  // The bond shell already paid holders. A cash shortfall becomes an explicit
  // emergency bridge and crisis exposure, never fictional Cabinet funding.
  const emergencyAdvanceDrawn = Math.max(0, prepaidBonds - liquidAfterIssuance);
  let available = liquidAfterIssuance + emergencyAdvanceDrawn - prepaidBonds;
  const paid = emptyClaims();
  const arrears = emptyClaims();
  let appropriationFinancing = 0;
  for (const category of NATIONAL_CLAIM_PRIORITY) {
    if (category === "mandatory" && input.fundOperatingAppropriations) {
      const operatingDue = NATIONAL_CLAIM_PRIORITY.filter(
        (claimCategory) => claimCategory !== "interest"
      ).reduce((sum, claimCategory) => sum + due[claimCategory], 0);
      appropriationFinancing = Math.max(0, operatingDue - available);
      available += appropriationFinancing;
    }
    const prepaid = category === "interest" ? prepaidCoupon : 0;
    paid[category] = prepaid + Math.min(due[category] - prepaid, available);
    arrears[category] = due[category] - paid[category];
    available -= paid[category] - prepaid;
  }
  const totalPaid = sumClaims(paid);
  const closing: NationalTreasuryState = {
    cash: available,
    debt: state.debt + input.bondFaceIssued - input.bondFaceRetired,
    debtCeiling: state.debtCeiling,
    emergencyAdvance: state.emergencyAdvance + emergencyAdvanceDrawn,
    arrears,
  };
  return {
    closing,
    due,
    paid,
    interestDue,
    maturityOutlay: input.bondMaturityCashPaid,
    emergencyAdvanceDrawn,
    appropriationFinancing,
    externalOutlay: totalPaid - paid.grants + input.bondMaturityCashPaid,
    grantTransfer: paid.grants,
    totalPaid,
    requestedFinancing: Math.max(
      0,
      sumClaims(due) + input.bondMaturityCashPaid - liquidBeforeBonds
    ),
    ceilingExceeded: closing.debt + closing.emergencyAdvance > closing.debtCeiling,
    accountingResidual:
      liquidBeforeBonds +
      input.bondProceeds +
      emergencyAdvanceDrawn -
      input.bondMaturityCashPaid +
      appropriationFinancing -
      totalPaid -
      closing.cash,
  };
}

/** Protected claims survive a shortfall; discretionary work simply scales down. */
export function settleRegionalTreasury(
  state: RegionalTreasuryState,
  input: RegionalTurnInput
): RegionalTurnSettlement {
  const cash = amount(state.cash, "regional cash");
  const openingArrears = amount(state.arrears, "regional arrears");
  const revenue = amount(input.ownRevenue, "regional revenue");
  const grant = amount(input.grantReceived, "regional grant");
  const protectedClaims = amount(input.protectedClaims, "protected claims");
  const discretionaryClaims = amount(input.discretionaryClaims, "discretionary claims");
  const available = cash + revenue + grant;
  const arrearsPaid = Math.min(openingArrears, available);
  const protectedPaid = Math.min(protectedClaims, available - arrearsPaid);
  const discretionaryPaid = Math.min(discretionaryClaims, available - arrearsPaid - protectedPaid);
  const closing: RegionalTreasuryState = {
    cash: available - arrearsPaid - protectedPaid - discretionaryPaid,
    arrears: openingArrears - arrearsPaid + protectedClaims - protectedPaid,
  };
  return {
    closing,
    protectedPaid,
    discretionaryPaid,
    arrearsPaid,
    newProtectedArrears: protectedClaims - protectedPaid,
    deliveryRatio: discretionaryClaims === 0 ? 1 : discretionaryPaid / discretionaryClaims,
    accountingResidual: available - arrearsPaid - protectedPaid - discretionaryPaid - closing.cash,
  };
}

/** A paid national grant is one debit and regional credits totaling the same amount. */
export function reconcileGrantTransfer(
  national: NationalTurnSettlement,
  regionalGrantCredits: readonly number[]
): number {
  const credits = regionalGrantCredits.reduce(
    (sum, credit, index) => sum + amount(credit, `regionalGrantCredits.${index}`),
    0
  );
  return national.grantTransfer - credits;
}
