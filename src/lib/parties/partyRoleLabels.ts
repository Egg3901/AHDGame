import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PartyLeadershipTitleKey, PartyLeadershipTitles } from "@/lib/db/types/party";

export type PartyRoleLabelKey = PartyLeadershipTitleKey | "committee";

export const MAX_PARTY_LEADERSHIP_TITLE_LENGTH = 40;

const DEFAULT_PARTY_ROLE_LABELS: Record<PartyRoleLabelKey, string> = {
  chair: "National Chair",
  viceChair: "National Vice Chair",
  treasurer: "National Treasurer",
  committee: "National Committee",
};

/**
 * Country-aware label for a party leadership / committee role. A party title
 * override takes precedence for its national leadership roles.
 *
 * Accepts any string for ergonomics at client call sites (route `[code]` params
 * arrive as lowercase strings). Normalizes case and falls back to the default
 * English label when the country is unknown or defines no override.
 */
export function getPartyRoleLabel(
  countryId: string,
  key: PartyRoleLabelKey,
  leadershipTitles?: PartyLeadershipTitles | null
): string {
  const partyTitle = key === "committee" ? null : leadershipTitles?.[key]?.trim();
  if (partyTitle) return partyTitle;

  const config = COUNTRY_CONFIGS[countryId.toUpperCase() as CountryId];
  const override = config?.partyRoleLabels?.[key];
  return override ?? DEFAULT_PARTY_ROLE_LABELS[key];
}
