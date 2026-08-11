import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";

export type OpenMarketOperation = "qe" | "qt";

export interface OpenMarketOperationInput {
  operation: OpenMarketOperation;
  requestedUnits: number;
  publicFloat: number;
  centralBankHoldings: number;
  totalIssued: number;
  marketPrice: number;
}

export interface OpenMarketOperationPlan {
  operation: OpenMarketOperation;
  units: number;
  publicFloat: number;
  centralBankHoldings: number;
  consideration: number;
  moneySupplyDelta: number;
  qeSupportRatio: number;
}

export function planOpenMarketOperation(input: OpenMarketOperationInput): OpenMarketOperationPlan {
  const requested = Math.max(0, Math.floor(input.requestedUnits));
  const available =
    input.operation === "qe"
      ? Math.max(0, Math.floor(input.publicFloat))
      : Math.max(0, Math.floor(input.centralBankHoldings));
  const units = Math.min(requested, available);
  const consideration =
    Math.round(units * BOND_UNIT_FACE_VALUE * Math.max(0.01, input.marketPrice) * 100) / 100;
  const centralBankHoldings =
    input.operation === "qe"
      ? input.centralBankHoldings + units
      : input.centralBankHoldings - units;
  const publicFloat =
    input.operation === "qe" ? input.publicFloat - units : input.publicFloat + units;
  const totalUnits = Math.max(1, input.totalIssued / BOND_UNIT_FACE_VALUE);

  return {
    operation: input.operation,
    units,
    publicFloat,
    centralBankHoldings,
    consideration,
    moneySupplyDelta: input.operation === "qe" ? consideration : -consideration,
    qeSupportRatio: Math.min(1, Math.max(0, centralBankHoldings / totalUnits)),
  };
}

/** Persistent demand support applied on top of the ordinary rate-derived price. */
export function applyQePriceSupport(rateDerivedPrice: number, qeSupportRatio: number): number {
  const support = Math.min(0.2, Math.max(0, qeSupportRatio) * 0.5);
  return Math.min(2, Math.max(0.05, rateDerivedPrice * (1 + support)));
}
