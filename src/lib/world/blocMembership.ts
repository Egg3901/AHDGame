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

/**
 * The organisation a bloc admits new members through, in this world.
 *
 * ⚠️ Keyed on the PRESET, exactly as `loadBlocMembership` above is — never on the
 * live year. `resolveAlignmentEra` flips to the post-Cold-War era at 1991, where the
 * only accession channels are WASHINGTON ones: Moscow and Beijing have no surviving
 * bloc org there. A year-derived lookup would therefore return nothing for the East
 * the moment a 1953 game's clock passed 1991 — and the winner of a proxy war would
 * take a country into an organisation that does not exist, admitting nobody, in
 * silence. A 1953 world has a Warsaw Pact in its year 2050.
 */
export function blocOrgFor(preset: string | undefined, bloc: WorldBloc): string | null {
  const year = PRESET_YEAR[preset ?? ""] ?? PRESET_YEAR[DEFAULT_PRESET];
  for (const channel of resolveAlignmentEra(year).channels) {
    if (!channel.alignmentAccession) continue;
    if (BLOC_BY_POLE[channel.poleId] !== bloc) continue;
    if (!(channel.organizationId in INTERNATIONAL_ORGANIZATIONS)) continue;
    return channel.organizationId;
  }
  return null;
}

/**
 * The accession-governing organisations a country may NOT hold alongside
 * `organizationId` — the bloc alliances of every other pole in this world.
 *
 * You cannot be in NATO and the Warsaw Pact at once. That is not a cosmetic
 * rule: `loadBlocMembership` above writes `out[countryId] = bloc` once per row
 * with no precedence, so a country holding a row in both poles reads as whichever
 * document Mongo returned last, and every military and alignment call downstream
 * reads that map. A dual member's own bloc is a coin flip.
 *
 * Empty for an org that does not govern accession (joining the UN costs a country
 * nothing it already holds), and empty where the era has only one such channel.
 *
 * ⚠️ Keyed on the PRESET, exactly as `blocOrgFor` above is, and for the same
 * reason: a year-derived lookup returns no eastern channel once a 1953 game's
 * clock passes 1991, and the exclusivity would go silently inert mid-game.
 */
export function rivalBlocOrgsFor(preset: string | undefined, organizationId: string): string[] {
  const year = PRESET_YEAR[preset ?? ""] ?? PRESET_YEAR[DEFAULT_PRESET];
  const channels = resolveAlignmentEra(year).channels.filter(
    (channel) => channel.alignmentAccession && channel.organizationId in INTERNATIONAL_ORGANIZATIONS
  );
  const own = channels.find((channel) => channel.organizationId === organizationId);
  if (!own) return [];
  return channels
    .filter((channel) => channel.poleId !== own.poleId)
    .map((channel) => channel.organizationId);
}

/**
 * The display name of the alliance a bloc admits through, for player-facing copy.
 *
 * Resolved from the same preset-keyed channel list as `blocOrgFor` so a refusal names
 * the treaty a player can actually read on the organisation page ("the Warsaw Pact"),
 * not the internal bloc token ("east"). Null when the bloc has no accession-governing
 * organisation in this world, which is the honest answer rather than a guessed name.
 */
export function allianceNameFor(preset: string | undefined, bloc: WorldBloc): string | null {
  const orgId = blocOrgFor(preset, bloc);
  if (!orgId) return null;
  return (
    INTERNATIONAL_ORGANIZATIONS[orgId as keyof typeof INTERNATIONAL_ORGANIZATIONS]?.name ?? null
  );
}
