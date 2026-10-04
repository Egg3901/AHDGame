/** Pure planning and claim construction for bank-held sovereign coupons. */
import type { Bond } from "@/lib/db/types/bond";
import type { BankSovereignClaim } from "@/lib/db/types/budget";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  BOND_UNIT_FACE_VALUE,
  bondAccruesCoupon,
  perTurnCouponPayment,
} from "@/lib/constants/bonds";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";

export interface BankCouponPlan {
  bankId: string;
  charteredTurn: number;
  amountLocal: number;
  bondIds: string[];
}

/** Freeze the eligible bank coupon slice from the opening sovereign bond snapshot. */
export function bankCouponPlanForCountry(
  bonds: readonly Bond[],
  countryId: string,
  currencyCode: CurrencyCode
): BankCouponPlan[] {
  const byEpoch = new Map<string, BankCouponPlan>();
  for (const bond of bonds) {
    if (bond.issuerType !== "sovereign" || bond.countryId !== countryId || !bondAccruesCoupon(bond))
      continue;
    const bondCurrency =
      bond.currencyCode ??
      COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
    if (bondCurrency !== currencyCode) continue;
    for (const holder of bond.holders ?? []) {
      if (
        !holder.bankId ||
        !Number.isSafeInteger(holder.charteredTurn) ||
        (holder.charteredTurn ?? 0) < 0
      )
        continue;
      const bankId = holder.bankId.toHexString();
      const charteredTurn = holder.charteredTurn!;
      const key = `${bankId}:${charteredTurn}`;
      const plan = byEpoch.get(key) ?? { bankId, charteredTurn, amountLocal: 0, bondIds: [] };
      plan.amountLocal +=
        perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * holder.units;
      plan.bondIds.push(bond._id.toHexString());
      byEpoch.set(key, plan);
    }
  }
  return [...byEpoch.values()]
    .map((plan) => ({
      ...plan,
      amountLocal: roundSavingsAmount(plan.amountLocal, currencyCode),
      bondIds: [...new Set(plan.bondIds)].sort(),
    }))
    .filter((plan) => plan.amountLocal > 0)
    .sort((a, b) => a.bankId.localeCompare(b.bankId) || a.charteredTurn - b.charteredTurn);
}

export function bankCouponClaim(input: {
  countryId: string;
  currencyCode: CurrencyCode;
  turn: number;
  plan: BankCouponPlan;
  anchorRate?: number;
  ledgerShadow?: boolean;
  ledgerCreatedAt: Date;
}): BankSovereignClaim {
  const { countryId, currencyCode, turn, plan } = input;
  return {
    id: `bank-sovereign-coupon:${countryId}:${turn}:${plan.bankId}:${plan.charteredTurn}`,
    kind: "coupon",
    bankId: plan.bankId,
    charteredTurn: plan.charteredTurn,
    countryId,
    currencyCode,
    amountLocal: plan.amountLocal,
    turn,
    bondIds: plan.bondIds,
    ledgerCreatedAt: input.ledgerCreatedAt,
    ...(input.anchorRate !== undefined ? { anchorRate: input.anchorRate } : {}),
    ...(input.ledgerShadow ? { ledgerShadow: true } : {}),
  };
}
