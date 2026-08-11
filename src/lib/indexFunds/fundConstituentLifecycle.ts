import type { IndexFund, IndexFundHolding } from "@/lib/db/types";
import {
  isEligibleIndexFundConstituent,
  type IndexFundCandidate,
} from "@/lib/indexFunds/constituents";

/** Holdings that should be sold because they left the target basket or became ineligible. */
export function findRemovedConstituentHoldings(
  fund: Pick<
    IndexFund,
    "holdings" | "targetConstituents" | "scope" | "kind" | "countryId" | "sectorType"
  >,
  corps: IndexFundCandidate[]
): IndexFundHolding[] {
  const targetIds = new Set(fund.targetConstituents.map((t) => t.corporationId.toString()));
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  return fund.holdings.filter((holding) => {
    const corpKey = holding.corporationId.toString();
    if (targetIds.has(corpKey)) return false;

    const corp = corpById.get(corpKey);
    if (!corp) return true;

    return !isEligibleIndexFundConstituent(corp, {
      scope: fund.scope,
      kind: fund.kind,
      countryId: fund.countryId,
      sectorType: fund.sectorType,
    });
  });
}
