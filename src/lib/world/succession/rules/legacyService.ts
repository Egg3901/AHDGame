/**
 * Legacy federation debt service collects agreed successor contributions into
 * the retired issuer's settlement administration. planLegacyDebtService keeps
 * creditor contracts with their original issuer and records funding shortfalls.
 */
import { allocateSuccessionDebtService, type SuccessionFinancialPlan } from "./financialSettlement";
import type { Bond } from "@/lib/db/types/bond";
import type { CountryId } from "@/lib/constants/countries";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { resolveBondCurrency } from "@/lib/bonds/resolveBondCurrency";

export interface LegacyBondDue {
  bondId: string;
  currencyCode: string;
  couponMinor: number;
  maturityMinor: number;
}

/** Mirror the live bond turn's external coupon and maturity cash legs. Bonds
 * stay with their original issuer and denomination; the administration calls
 * successors for the shared-accounting value at the prevailing exchange rate. */
export function planLegacyBondDue(input: {
  bonds: readonly Bond[];
  issuerId: CountryId;
  turn: number;
  ratesLocalPerAnchor: Readonly<Record<string, number>>;
}): { couponMinor: number; maturityMinor: number; totalMinor: number; bonds: LegacyBondDue[] } {
  const { bonds, issuerId, turn, ratesLocalPerAnchor } = input;
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("Legacy service needs a valid turn");
  const seen = new Set<string>();
  const lines: LegacyBondDue[] = [];
  let couponMinor = 0;
  let maturityMinor = 0;
  for (const bond of bonds) {
    const bondId = bond._id.toString();
    if (seen.has(bondId) || bond.issuerType !== "sovereign" || bond.countryId !== issuerId)
      throw new Error("Legacy service received a duplicate or foreign creditor contract");
    seen.add(bondId);
    if (bond.matured || bond.defaulted) continue;
    const currencyCode = resolveBondCurrency(bond);
    const rate = ratesLocalPerAnchor[currencyCode];
    if (!Number.isFinite(rate) || rate <= 0)
      throw new Error(`Legacy service lacks the live ${currencyCode} exchange rate`);
    const units = bond.holders.reduce((sum, holder) => sum + holder.units, 0) + bond.publicFloat;
    if (
      !Number.isSafeInteger(units) ||
      units < 0 ||
      !Number.isFinite(bond.couponRate) ||
      bond.couponRate < 0 ||
      !Number.isSafeInteger(bond.maturityTurn)
    )
      throw new Error("Legacy creditor contract has invalid payment terms");
    const coupon = Math.round(
      ((perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * units) / rate) * 100
    );
    const maturity =
      bond.maturityTurn <= turn ? Math.round(((BOND_UNIT_FACE_VALUE * units) / rate) * 100) : 0;
    if (!Number.isSafeInteger(coupon) || !Number.isSafeInteger(maturity))
      throw new Error("Legacy creditor payment exceeds shared accounting precision");
    couponMinor += coupon;
    maturityMinor += maturity;
    if (!Number.isSafeInteger(couponMinor) || !Number.isSafeInteger(maturityMinor))
      throw new Error("Legacy creditor service exceeds shared accounting precision");
    lines.push({ bondId, currencyCode, couponMinor: coupon, maturityMinor: maturity });
  }
  const totalMinor = couponMinor + maturityMinor;
  if (!Number.isSafeInteger(totalMinor))
    throw new Error("Legacy creditor service exceeds shared accounting precision");
  return {
    couponMinor,
    maturityMinor,
    totalMinor,
    bonds: lines.sort((a, b) => a.bondId.localeCompare(b.bondId)),
  };
}

export interface LegacyServiceInput {
  finances: SuccessionFinancialPlan;
  /** Contractual payment due this turn, in the existing issuer's accounting minor units. */
  dueMinor: number;
  /** Existing cash in the legacy settlement administration before contributions. */
  administrationCashMinor: number;
  /** Actual available successor budget balances after protected spending. */
  availableMinorBySuccessor: Readonly<Record<string, number>>;
}

export interface LegacyServicePlan {
  settlementId: string;
  servicingIssuerId: string;
  dueMinor: number;
  successorCallsMinor: Record<string, number>;
  successorContributionsMinor: Record<string, number>;
  successorArrearsMinor: Record<string, number>;
  creditorPaymentMinor: number;
  creditorShortfallMinor: number;
  administrationCashAfterMinor: number;
}

function whole(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative safe integer`);
}

/** No successor creates a new creditor bond; its unpaid contribution is an internal claim. */
export function planLegacyDebtService(input: LegacyServiceInput): LegacyServicePlan {
  if (input.finances.servicingEntityKind !== "legacy-administration")
    throw new Error("Existing continuing states service contracts through their own budget");
  whole(input.dueMinor, "Contractual service");
  whole(input.administrationCashMinor, "Administration cash");
  const successorCallsMinor = allocateSuccessionDebtService(input.finances, input.dueMinor);
  const ids = Object.keys(successorCallsMinor).sort();
  if (
    Object.keys(input.availableMinorBySuccessor).length !== ids.length ||
    ids.some((id) => !Object.hasOwn(input.availableMinorBySuccessor, id))
  )
    throw new Error("Every successor budget must be available for service planning");
  const successorContributionsMinor: Record<string, number> = {};
  const successorArrearsMinor: Record<string, number> = {};
  let received = BigInt(0);
  for (const id of ids) {
    const available = input.availableMinorBySuccessor[id];
    whole(available, "Successor available balance");
    const contribution = Math.min(successorCallsMinor[id], available);
    successorContributionsMinor[id] = contribution;
    successorArrearsMinor[id] = successorCallsMinor[id] - contribution;
    received += BigInt(contribution);
  }
  const cash = BigInt(input.administrationCashMinor) + received;
  if (cash > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Settlement cash exceeds supported accounting precision");
  const payment = cash < BigInt(input.dueMinor) ? cash : BigInt(input.dueMinor);
  return {
    settlementId: input.finances.settlementId,
    servicingIssuerId: input.finances.servicingIssuerId,
    dueMinor: input.dueMinor,
    successorCallsMinor,
    successorContributionsMinor,
    successorArrearsMinor,
    creditorPaymentMinor: Number(payment),
    creditorShortfallMinor: input.dueMinor - Number(payment),
    administrationCashAfterMinor: Number(cash - payment),
  };
}
