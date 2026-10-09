import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";

export type PartyRoleLabelKey = "chair" | "viceChair" | "treasurer" | "committee";

const DEFAULT_PARTY_ROLE_LABELS: Record<PartyRoleLabelKey, string> = {
  chair: "National Chair",
  viceChair: "National Vice Chair",
  treasurer: "National Treasurer",
  committee: "National Committee",
};

/**
 * Country-aware label for a party leadership / committee role.
 *
 * Accepts any string for ergonomics at client call sites (route `[code]` params
 * arrive as lowercase strings). Normalizes case and falls back to the default
 * English label when the country is unknown or defines no override.
 */
export function getPartyRoleLabel(countryId: string, key: PartyRoleLabelKey): string {
  const config = COUNTRY_CONFIGS[countryId.toUpperCase() as CountryId];
  const override = config?.partyRoleLabels?.[key];
  return override ?? DEFAULT_PARTY_ROLE_LABELS[key];
}

/**
 * Display label for one of a party's three national leadership offices, with
 * the party's own chair-set flavor override (`PoliticalParty.officerTitleOverrides`)
 * taking precedence over the country-scoped label. `committee` is not overridable
 * and always falls through to the country label.
 */
export function getPartyDisplayRoleLabel(
  party: Pick<PoliticalParty, "officerTitleOverrides">,
  countryId: string,
  key: Exclude<PartyRoleLabelKey, "committee">
): string {
  const override = party.officerTitleOverrides?.[key];
  return override && override.trim() ? override : getPartyRoleLabel(countryId, key);
}
