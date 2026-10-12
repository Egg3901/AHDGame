import type { IndexFund } from "@/lib/db/types/indexFund";
import { getAllFundDefinitions } from "./fundDefinitions";
import { legacyIndexMandate, type FundMandate } from "./rules/mandate";

const originalPolicies = new Map(getAllFundDefinitions().map((policy) => [policy.slug, policy]));

/** Stored policy wins. Slugs are consulted only for pre-mandate compatibility. */
export function resolveFundMandate(
  fund: Pick<
    IndexFund,
    "mandate" | "slug" | "scope" | "kind" | "countryId" | "sectorType" | "anchorCurrencyCode"
  >
): FundMandate {
  if (fund.mandate) return fund.mandate;
  return legacyIndexMandate(
    {
      scope: fund.scope,
      kind: fund.kind,
      countryId: fund.countryId,
      sectorType: fund.sectorType,
      anchorCurrencyCode: fund.anchorCurrencyCode,
    },
    originalPolicies.get(fund.slug)
  );
}
