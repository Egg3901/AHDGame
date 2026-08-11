import type { ObjectId, Db } from "mongodb";
import type { IndexFundPosition } from "@/lib/db/types";

export type EnrichedFundHolder = {
  holderKind: IndexFundPosition["holderKind"];
  holderId: string;
  displayName: string;
  units: number;
  avgNavAnchor: number | null;
  marketValueAnchor: number | null;
  countryId?: string;
  party?: string;
};

/** Resolve display names for fund unit holders (players, NPPs, reserve). */
export async function enrichFundPositions(
  db: Db,
  positions: IndexFundPosition[],
  quotedNav: number
): Promise<EnrichedFundHolder[]> {
  const nonZero = positions.filter((p) => p.units > 0);
  if (nonZero.length === 0) return [];

  const characterIds = nonZero
    .filter((p) => p.holderKind === "character" && p.characterId)
    .map((p) => p.characterId!);
  const nppIds = nonZero.filter((p) => p.holderKind === "npp" && p.nppId).map((p) => p.nppId!);
  const imperialIds = nonZero
    .filter((p) => p.holderKind === "imperial_character" && p.imperialCharacterId)
    .map((p) => p.imperialCharacterId!);

  const [characters, npps, imperials] = await Promise.all([
    characterIds.length
      ? db
          .collection<{ _id: ObjectId; name: string }>("characters")
          .find({ _id: { $in: characterIds } })
          .project({ name: 1 })
          .toArray()
      : Promise.resolve([]),
    nppIds.length
      ? db
          .collection<{ _id: ObjectId; name: string; countryId?: string; party?: string }>("npps")
          .find({ _id: { $in: nppIds } })
          .project({ name: 1, countryId: 1, party: 1 })
          .toArray()
      : Promise.resolve([]),
    imperialIds.length
      ? db
          .collection<{ _id: ObjectId; name: string }>("imperialCharacters")
          .find({ _id: { $in: imperialIds } })
          .project({ name: 1 })
          .toArray()
      : Promise.resolve([]),
  ]);

  const charById = new Map(characters.map((c) => [c._id.toString(), c.name]));
  const nppById = new Map(npps.map((n) => [n._id.toString(), n]));
  const impById = new Map(imperials.map((c) => [c._id.toString(), c.name]));

  return nonZero.map((p) => {
    const marketValueAnchor = p.units * quotedNav;
    if (p.holderKind === "fund_reserve") {
      return {
        holderKind: p.holderKind,
        holderId: "reserve",
        displayName: "Fund reserve (seed float)",
        units: p.units,
        avgNavAnchor: p.avgNavAnchor ?? null,
        marketValueAnchor,
      };
    }
    if (p.holderKind === "character" && p.characterId) {
      const id = p.characterId.toString();
      return {
        holderKind: p.holderKind,
        holderId: id,
        displayName: charById.get(id) ?? "Unknown player",
        units: p.units,
        avgNavAnchor: p.avgNavAnchor ?? null,
        marketValueAnchor,
      };
    }
    if (p.holderKind === "npp" && p.nppId) {
      const id = p.nppId.toString();
      const npp = nppById.get(id);
      return {
        holderKind: p.holderKind,
        holderId: id,
        displayName: npp?.name ?? "Unknown NPP",
        units: p.units,
        avgNavAnchor: p.avgNavAnchor ?? null,
        marketValueAnchor,
        countryId: npp?.countryId,
        party: npp?.party,
      };
    }
    if (p.holderKind === "imperial_character" && p.imperialCharacterId) {
      const id = p.imperialCharacterId.toString();
      return {
        holderKind: p.holderKind,
        holderId: id,
        displayName: impById.get(id) ?? "Unknown imperial",
        units: p.units,
        avgNavAnchor: p.avgNavAnchor ?? null,
        marketValueAnchor,
      };
    }
    return {
      holderKind: p.holderKind,
      holderId: "unknown",
      displayName: "Unknown holder",
      units: p.units,
      avgNavAnchor: p.avgNavAnchor ?? null,
      marketValueAnchor,
    };
  });
}
