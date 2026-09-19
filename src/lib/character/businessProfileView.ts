/**
 * Business profiles expose a current CEO role and investor eligibility.
 * businessProfileView keeps portfolio values and position counts in the owner view only.
 */
import type { getFinancialData } from "./financialData";
export function businessProfileView(
  data: Awaited<ReturnType<typeof getFinancialData>>,
  own: boolean
) {
  if (!data.corporation && !data.isInvestor) return null;
  return {
    corporation: data.corporation
      ? {
          name: data.corporation.name,
          id: data.corporation.sequentialId ? String(data.corporation.sequentialId) : null,
          type: data.corporation.type,
        }
      : null,
    isInvestor: data.isInvestor,
    finances: own
      ? {
          portfolioValue: data.portfolioValue,
          dividendIncomePerTurn: data.dividendIncomePerTurn,
          bondIncomePerTurn: data.bondIncomePerTurn,
          equityHoldingCount: data.equityHoldingCount,
          bondHoldingCount: data.bondHoldingCount,
          hasFundHoldings: data.hasFundHoldings,
        }
      : null,
  };
}
export type BusinessProfileView = NonNullable<ReturnType<typeof businessProfileView>>;
