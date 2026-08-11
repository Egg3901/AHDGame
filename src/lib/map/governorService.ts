import type { Db } from "mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface MapGovernorState {
  leadingParty: string;
  leadColor: string;
  governorName: string;
  tooltip: string[];
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

export async function computeGovernorMap(
  db: Db,
  countryId: CountryId
): Promise<Record<string, MapGovernorState>> {
  // Query without countryId filter since older records may not have it set
  const [parties, allGovernors] = await Promise.all([
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
    db.collection<ElectedOfficial>("electedOfficials").find({ officeType: "governor" }).toArray(),
  ]);
  // Filter to correct country using countryId field
  const governors = allGovernors.filter((g) => g.state && (g.countryId ?? "US") === countryId);

  const partyColorMap = new Map(
    parties.map((p) => [String(p.sequentialId), partyColor(String(p.sequentialId), p.color)])
  );
  const partyNameMap = new Map(parties.map((p) => [String(p.sequentialId), p.name]));

  const result: Record<string, MapGovernorState> = {};
  for (const g of governors) {
    if (!g.state) continue;
    const pId = g.party ?? "independent";
    const name = partyNameMap.get(pId) ?? pId;
    result[g.state] = {
      leadingParty: pId,
      leadColor: partyColorMap.get(pId) ?? partyColor(pId),
      governorName: g.characterName ?? "Vacant",
      tooltip: [`${name}: ${g.characterName ?? "Vacant"}`],
    };
  }
  return result;
}
