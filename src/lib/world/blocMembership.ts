/**
 * Which bloc each entity actually belongs to, read from live membership.
 *
 * The globe's bloc mode used to paint from a hand-written 1953 judgment table:
 * every country the era touched was filed West, East or non-aligned by
 * sympathy. That made a handsome map and a misleading one — Spain and Brazil
 * were blue without being in NATO, West Germany was blue two years before it
 * joined, and the colours could not move when a nation actually acceded or
 * withdrew. This reads the treaty instead: a bloc's colour is its ROLL.
 *
 * Derived from the era's `channels` rather than from a hardcoded pair of org
 * ids, so whichever organisations carry a pole in a given era are the ones that
 * colour the map. Only channels that govern accession count — an org that
 * carries influence without a membership gate (the EU) does not make a country
 * "West".
 */
import type { Db } from "mongodb";
import { resolveAlignmentEra, type AlignmentPoleId } from "@/lib/constants/alignmentEras";
import { PRESET_YEAR, DEFAULT_PRESET } from "@/lib/constants/alignmentSeeds";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import { getOrganizationMembershipsCollection } from "@/lib/db/collections";
import type { WorldBloc } from "@/lib/world/bloc";

/** Which side of the board a pole sits on. Unmapped poles colour nothing. */
const BLOC_BY_POLE: Partial<Record<AlignmentPoleId, WorldBloc>> = {
  WEST: "west",
  EAST: "east",
  WASHINGTON: "west",
  MOSCOW: "east",
};

export type BlocMembership = Record<string, WorldBloc>;

/**
 * entityId → bloc, for every member of an accession-governing organisation.
 *
 * Members of any tier are included: NATO seats Canada and the Benelux as
 * background entities, and an alliance that does not draw its own members is
 * not drawing the alliance.
 */
export async function loadBlocMembership(
  db: Db,
  preset: string | undefined
): Promise<BlocMembership> {
  const year = PRESET_YEAR[preset ?? ""] ?? PRESET_YEAR[DEFAULT_PRESET];
  const blocByOrg = new Map<string, WorldBloc>();
  for (const channel of resolveAlignmentEra(year).channels) {
    if (!channel.alignmentAccession) continue;
    const bloc = BLOC_BY_POLE[channel.poleId];
    if (!bloc) continue;
    if (!(channel.organizationId in INTERNATIONAL_ORGANIZATIONS)) continue;
    blocByOrg.set(channel.organizationId, bloc);
  }
  if (blocByOrg.size === 0) return {};

  const col = await getOrganizationMembershipsCollection(db);
  const rows = await col
    .find(
      { organizationId: { $in: [...blocByOrg.keys()] } },
      { projection: { organizationId: 1, countryId: 1 } }
    )
    .toArray();

  const out: BlocMembership = {};
  for (const row of rows) {
    const bloc = blocByOrg.get(row.organizationId);
    if (bloc) out[String(row.countryId)] = bloc;
  }
  return out;
}
