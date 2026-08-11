import type { IndexFund } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/** Match stock-market exchange selector to visible index funds. */
export function filterFundsForExchange(
  funds: IndexFund[],
  exchange: "global" | CountryId
): IndexFund[] {
  if (exchange === "global") {
    return funds.filter((f) => f.scope === "global");
  }
  return funds.filter((f) => f.scope === "country" && f.countryId === exchange);
}
