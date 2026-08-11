import { ROSTER_BY_KEY, type AlignmentCountryKey } from "@/lib/constants/alignmentRoster";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";

/**
 * Display name and flag for any organisation member.
 *
 * Membership is open to every entity in the game, so a member may have no
 * CountryConfig at all. The alignment roster names every entity the world
 * models, which is the right fallback — and the id itself is the last resort so
 * a row can never render blank.
 */
export function entityName(id: OrgMemberId): string {
  return (
    COUNTRY_CONFIGS[id as CountryId]?.name ?? ROSTER_BY_KEY[id as AlignmentCountryKey]?.name ?? id
  );
}

/** Neutral flag for entities the game does not model as playable countries. */
export function entityFlag(id: OrgMemberId): string {
  return COUNTRY_CONFIGS[id as CountryId]?.flagEmoji ?? "🏳️";
}
