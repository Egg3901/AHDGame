import type { CountryId } from "@/lib/constants/countries";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";

/**
 * Which `regionalBudgets` field holds a country's central-government grant.
 *
 * `RegionalBudget` carries one grant field per country family (JP's
 * `nationalGrant`, DE's `federalEqualizationGrant`, CN/DD's
 * `centralTransferGrant`, UK's `westminsterGrant`, RU's `unionGrant`), so every
 * reader has to map country → field. Those mappings were written three separate
 * times as if/else chains, and each one ENDED IN A DEFAULT — `westminsterGrant`
 * in `federalBudgetDetail`. A country the chain did not name therefore read the
 * UK's field, silently, and reported DDM 0 rather than failing: DD's Länder grants
 * disappeared from the budget detail that way (#1323).
 *
 * A lookup that returns `undefined` for an unmapped country is the point. It
 * cannot quietly hand back another country's number, and a country added later
 * shows up as absent instead of as zero.
 */
export const REGIONAL_GRANT_FIELD: Partial<
  Record<
    CountryId,
    | "nationalGrant"
    | "federalEqualizationGrant"
    | "centralTransferGrant"
    | "westminsterGrant"
    | "unionGrant"
  >
> = {
  JP: "nationalGrant",
  DE: "federalEqualizationGrant",
  CN: "centralTransferGrant",
  DD: "federalEqualizationGrant",
  UK: "westminsterGrant",
  RU: "unionGrant",
};

/**
 * The grant this region actually received, or `undefined` when the country has
 * no mapped grant field (as opposed to a mapped field holding zero — callers
 * that want to fall back to `stateBudgets.revenue.federalGrants` need to tell
 * those two apart).
 */
export function regionalGrantAmount(
  countryId: CountryId,
  regionalBudget: RegionalBudget | undefined
): number | undefined {
  const field = REGIONAL_GRANT_FIELD[countryId];
  if (!field || !regionalBudget) return undefined;
  return regionalBudget[field] ?? 0;
}
