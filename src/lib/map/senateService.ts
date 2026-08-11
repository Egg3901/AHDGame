import type { Db } from "mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface MapSenateSeat {
  party: string;
  color: string;
  name: string;
}

export interface MapSenateState {
  seat1: MapSenateSeat | null;
  seat2: MapSenateSeat | null;
}

const DEFAULT_COLORS: Record<string, string> = {
  democrat: "#3B82F6",
  republican: "#EF4444",
  independent: "#9CA3AF",
  LAB: "#E4003B",
  CON: "#0087DC",
  LD: "#FAA61A",
  SNP: "#FFF95D",
  PC: "#3F8428",
  GREEN: "#02A95B",
  REF: "#12B6CF",
};

function partyColor(partyId: string, storedColor?: string): string {
  return DEFAULT_COLORS[partyId] ?? storedColor ?? "#8B5CF6";
}

export async function computeSenateMap(
  db: Db,
  countryId: CountryId
): Promise<Record<string, MapSenateState>> {
  // Query without countryId filter since older records may not have it set
  const [parties, allSenators] = await Promise.all([
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: "senate" })
      .sort({ state: 1, senateClass: 1 })
      .toArray(),
  ]);
  // Filter to correct country using countryId field
  const senators = allSenators.filter((s) => s.state && (s.countryId ?? "US") === countryId);

  const partyColorMap = new Map(
    parties.map((p) => [String(p.sequentialId), partyColor(String(p.sequentialId), p.color)])
  );

  const byState = new Map<string, ElectedOfficial[]>();
  for (const s of senators) {
    if (!s.state) continue;
    const list = byState.get(s.state) ?? [];
    list.push(s);
    byState.set(s.state, list);
  }

  const result: Record<string, MapSenateState> = {};
  const toSeat = (o: ElectedOfficial | undefined) => {
    if (!o) return null;
    // A seat row with no seated character is a vacancy, not an independent.
    // Returning null makes the map fall through to the shared dark vacant
    // color (#334155) instead of the light-gray "independent" color, so all
    // vacant senate seats render consistently (#913 — some ID dark, IL/AK light).
    if (!o.characterName) return null;
    const pId = o.party ?? "independent";
    return {
      party: pId,
      color: partyColorMap.get(pId) ?? partyColor(pId),
      name: o.characterName ?? "Vacant",
    };
  };

  for (const [stateId, seats] of byState.entries()) {
    result[stateId] = { seat1: toSeat(seats[0]), seat2: toSeat(seats[1]) };
  }

  return result;
}
