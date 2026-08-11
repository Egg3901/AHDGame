import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import type { CountryId } from "@/lib/constants/countries";
import { ROSTER_BY_KEY } from "@/lib/constants/alignmentRoster";
import type { OrgSummary } from "../orgTypes";

/** Whether `countryId` is a member of `org`. */
export function isCountryInOrg(org: OrgSummary, countryId: CountryId): boolean {
  return org.members.some((m) => m.countryId === countryId);
}

/** Index every org under each of its member countries (insertion order preserved). */
export function orgMembersByCountry(orgs: OrgSummary[]): Map<OrgMemberId, OrgSummary[]> {
  // Keyed by entity: any nation in the game may belong to an organisation.
  const byCountry = new Map<OrgMemberId, OrgSummary[]>();
  for (const org of orgs) {
    for (const m of org.members) {
      const list = byCountry.get(m.countryId) ?? [];
      list.push(org);
      byCountry.set(m.countryId, list);
    }
  }
  return byCountry;
}

/**
 * The entities an organisation's colour covers: its members, and only its
 * members.
 *
 * Dependencies are deliberately NOT included. Shading them made the map assert
 * something false — the legend reads "Members of NATO" while 75 colonies and
 * protectorates were painted alongside the 14 signatories, so the map claimed
 * Uganda and Malaya had joined the alliance. The North Atlantic Treaty is
 * explicit on the point: Article 6 draws a treaty area covering the Algerian
 * departments of France and the North Atlantic islands, and pointedly excludes
 * the members' other possessions. Painting them was not a shortcut for a truth
 * the map could not otherwise tell; it contradicted one.
 *
 * Constituent territory still shades, because it is not a dependency question:
 * Byelorussia and the Baltics fall inside the Soviet Union's own geometry, so
 * the soviet-union shard draws them as part of RU rather than beside it.
 *
 * This is also the key the map's overlay blobs are matched on, since a blob is
 * identified by the country that owns its regions rather than by an ISO code.
 */
export function memberEntityIds(org: OrgSummary | null): Set<string> {
  const ids = new Set<string>();
  if (!org) return ids;
  for (const m of org.members) ids.add(String(m.countryId));
  return ids;
}

/**
 * Map feature ids to shade for an organisation's members.
 *
 * Resolved through the alignment roster rather than through `CountryId`,
 * because membership is entity-wide: NATO's 1953 roster includes Canada and the
 * Benelux, which the game carries as background entities with map geometry but
 * no CountryId. Keying on CountryId left them unshaded — the member list said
 * fourteen and the map showed six.
 *
 * Present-day footprints only, and deliberately so. Where an entity's territory
 * differed from today's — the USSR, Czechoslovakia, Yugoslavia, a divided
 * Germany — the map draws a region-overlay blob from live ownership instead, and
 * the base features that blob covers are dropped before this set is consulted.
 */
export function memberFeatureIds(org: OrgSummary | null): Set<string> {
  const ids = new Set<string>();
  if (!org) return ids;
  for (const key of memberEntityIds(org)) {
    for (const iso of ROSTER_BY_KEY[key as keyof typeof ROSTER_BY_KEY]?.iso ?? []) ids.add(iso);
  }
  return ids;
}
