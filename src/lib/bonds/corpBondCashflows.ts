/**
 * Per-turn corporate bond cash flows, in ₳.
 *
 * Extracted from `sectorCalculations` so the NPP corporation brain can read the
 * same numbers the turn engine charges. They were module-private, which is a
 * large part of why the brain never saw debt service at all: the only code that
 * knew what a corp pays its bondholders was the code that charged it.
 *
 * Both helpers normalize per bond. A bond's amounts are denominated in
 * `bond.currencyCode` (Task 18B) while corp income math runs in ₳, so a US corp
 * holding a UK sovereign would otherwise sum GBP straight into ₳. Pre-migration
 * bonds carry no `currencyCode` and pass through, their totals already being ₳.
 */

import type { Bond } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE, perTurnCouponPayment } from "@/lib/constants/bonds";
import { corpCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/** Issuer-side bond interest expense in ₳ for one turn. */
export function perTurnIssuerBondInterestExpense(
  issuerBonds: Bond[] | undefined,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  if (!issuerBonds?.length) return 0;
  let annualCouponAnchor = 0;
  for (const b of issuerBonds) {
    const rate = b.currencyCode ? (fxByCurrency.get(b.currencyCode) ?? 1) : 1;
    const couponLocal = (b.couponRate / 100) * b.totalIssued;
    annualCouponAnchor += corpCapitalToAnchor(couponLocal, b.currencyCode, rate);
  }
  return annualCouponAnchor / TURNS_PER_YEAR;
}

/** Holder-side coupon income in ₳ for one turn. */
export function perTurnBondCouponIncomeAsHolder(
  positions: { bond: Bond; units: number }[] | undefined,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  if (!positions?.length) return 0;
  let sumAnchor = 0;
  for (const { bond, units } of positions) {
    const couponLocal = perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * units;
    const rate = bond.currencyCode ? (fxByCurrency.get(bond.currencyCode) ?? 1) : 1;
    sumAnchor += corpCapitalToAnchor(couponLocal, bond.currencyCode, rate);
  }
  return sumAnchor;
}

/**
 * NET per-turn debt service in ₳: what the corp pays its own bondholders, less
 * what it collects on bonds it holds. Positive means debt service is a drag.
 *
 * National enterprises are exempt from issuer interest (the government bond
 * subsidy), which is why `isNationalEnterprise` is a parameter rather than
 * something this module infers: the caller already knows, and the turn engine
 * applies the same waiver through `perTurnBondDragOnNetIncome`.
 */
export function netPerTurnDebtServiceAnchor(args: {
  issuerBonds: Bond[] | undefined;
  heldPositions: { bond: Bond; units: number }[] | undefined;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  isNationalEnterprise: boolean;
}): number {
  const expense = args.isNationalEnterprise
    ? 0
    : perTurnIssuerBondInterestExpense(args.issuerBonds, args.fxByCurrency);
  const income = perTurnBondCouponIncomeAsHolder(args.heldPositions, args.fxByCurrency);
  return expense - income;
}
