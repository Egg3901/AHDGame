import type { IndexFund } from "@/lib/db/types";
import {
  INDEX_FUND_MAX_EQUITY_ALLOCATION,
  INDEX_FUND_MIN_BOND_RESERVE_ALLOCATION,
} from "@/lib/indexFunds/unitAccounting";

/** Fraction of total backing kept as liquid cash inside the reserve bucket. */
export const INDEX_FUND_RESERVE_CASH_BUFFER_FRACTION = 0.05;

export type FundAllocationBreakdown = {
  holdingsValueAnchor: number;
  bondPrincipalAnchor: number;
  cashAnchor: number;
  totalBackingAnchor: number;
  equityShare: number;
  reserveShare: number;
  maxEquityValueAnchor: number;
  minReserveValueAnchor: number;
  targetBondValueAnchor: number;
  equityHeadroomAnchor: number;
  reserveShortfallAnchor: number;
  bondDeploymentNeededAnchor: number;
  cashAvailableForBondDeployAnchor: number;
  stockPurchaseBudgetAnchor: number;
};

/** @deprecated Synthetic ledger — use sumFundBondHoldingsValueAnchor for real holdings. */
export function sumBondPrincipalAnchor(fund: Pick<IndexFund, "bondAllocations">): number {
  return (fund.bondAllocations ?? []).reduce(
    (sum, row) =>
      sum + (Number.isFinite(row.principalAnchor) ? Math.max(0, row.principalAnchor) : 0),
    0
  );
}

export function computeHoldingsValueAnchor(fund: Pick<IndexFund, "holdings">): number {
  return fund.holdings.reduce((sum, holding) => {
    const value = holding.lastValueAnchor ?? holding.shares * (holding.avgCostPerShareAnchor ?? 0);
    return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
  }, 0);
}

export function computeTotalFundBackingAnchor(
  fund: Pick<IndexFund, "cashAnchor" | "holdings" | "bondAllocations">,
  options?: { bondPrincipalAnchor?: number }
): number {
  const cashAnchor = Number.isFinite(fund.cashAnchor) ? Math.max(0, fund.cashAnchor) : 0;
  const bondPrincipal = options?.bondPrincipalAnchor ?? sumBondPrincipalAnchor(fund);
  return computeHoldingsValueAnchor(fund) + bondPrincipal + cashAnchor;
}

/** At most 75% of backing in equities; at least 25% in the bond/cash reserve bucket. */
export function computeFundAllocationBreakdown(
  fund: Pick<IndexFund, "cashAnchor" | "holdings" | "bondAllocations">,
  options?: { bondPrincipalAnchor?: number }
): FundAllocationBreakdown {
  const holdingsValueAnchor = computeHoldingsValueAnchor(fund);
  const bondPrincipalAnchor = options?.bondPrincipalAnchor ?? sumBondPrincipalAnchor(fund);
  const cashAnchor = Number.isFinite(fund.cashAnchor) ? Math.max(0, fund.cashAnchor) : 0;
  const totalBackingAnchor = holdingsValueAnchor + bondPrincipalAnchor + cashAnchor;

  if (totalBackingAnchor <= 0) {
    return {
      holdingsValueAnchor: 0,
      bondPrincipalAnchor: 0,
      cashAnchor: 0,
      totalBackingAnchor: 0,
      equityShare: 0,
      reserveShare: 0,
      maxEquityValueAnchor: 0,
      minReserveValueAnchor: 0,
      targetBondValueAnchor: 0,
      equityHeadroomAnchor: 0,
      reserveShortfallAnchor: 0,
      bondDeploymentNeededAnchor: 0,
      cashAvailableForBondDeployAnchor: 0,
      stockPurchaseBudgetAnchor: 0,
    };
  }

  const reserveValueAnchor = bondPrincipalAnchor + cashAnchor;
  const maxEquityValueAnchor = INDEX_FUND_MAX_EQUITY_ALLOCATION * totalBackingAnchor;
  const minReserveValueAnchor = INDEX_FUND_MIN_BOND_RESERVE_ALLOCATION * totalBackingAnchor;
  const equityHeadroomAnchor = Math.max(0, maxEquityValueAnchor - holdingsValueAnchor);
  const reserveShortfallAnchor = Math.max(0, minReserveValueAnchor - reserveValueAnchor);
  const minCashBufferAnchor = Math.min(
    cashAnchor,
    INDEX_FUND_RESERVE_CASH_BUFFER_FRACTION * totalBackingAnchor
  );
  const targetBondValueAnchor = Math.max(0, minReserveValueAnchor - minCashBufferAnchor);
  const bondDeploymentNeededAnchor = Math.max(0, targetBondValueAnchor - bondPrincipalAnchor);
  const cashAvailableForBondDeployAnchor = Math.max(
    0,
    Math.min(bondDeploymentNeededAnchor, cashAnchor - minCashBufferAnchor)
  );
  const cashAfterBondDeploy = cashAnchor - cashAvailableForBondDeployAnchor;
  const stockPurchaseBudgetAnchor = Math.min(
    equityHeadroomAnchor,
    Math.max(0, cashAfterBondDeploy)
  );

  return {
    holdingsValueAnchor,
    bondPrincipalAnchor,
    cashAnchor,
    totalBackingAnchor,
    equityShare: holdingsValueAnchor / totalBackingAnchor,
    reserveShare: reserveValueAnchor / totalBackingAnchor,
    maxEquityValueAnchor,
    minReserveValueAnchor,
    targetBondValueAnchor,
    equityHeadroomAnchor,
    reserveShortfallAnchor,
    bondDeploymentNeededAnchor,
    cashAvailableForBondDeployAnchor,
    stockPurchaseBudgetAnchor,
  };
}

export { INDEX_FUND_MAX_EQUITY_ALLOCATION, INDEX_FUND_MIN_BOND_RESERVE_ALLOCATION };
