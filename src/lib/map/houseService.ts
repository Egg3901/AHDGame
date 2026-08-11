import type { Db } from "mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { UK_REGIONS } from "@/lib/constants/uk";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";

export interface MapHouseState {
  leadingParty: string;
  leadColor: string;
  seats: number;
  total: number;
  tooltip: string[];
}

const VACANT_COLOR = "#334155";
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

export async function computeHouseMap(
  db: Db,
  countryId: CountryId
): Promise<Record<string, MapHouseState>> {
  const officeType = getLowerChamberOfficeType(countryId);
  // Query without countryId filter since older records may not have it set,
  // then filter results by state prefix to ensure correct country
  const [parties, allReps] = await Promise.all([
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
    db.collection<ElectedOfficial>("electedOfficials").find({ officeType }).toArray(),
  ]);
  // Filter to correct country using countryId field
  const reps = allReps.filter((r) => r.state && (r.countryId ?? "US") === countryId);

  const partyColorMap = new Map(
    parties.map((p) => [String(p.sequentialId), partyColor(String(p.sequentialId), p.color)])
  );
  const partyNameMap = new Map(parties.map((p) => [String(p.sequentialId), p.name]));

  if (countryId === COUNTRY_CONFIGS.UK.id) {
    return buildCommonsUK(reps, partyColorMap, partyNameMap);
  }
  return buildHouseOrCommons(reps, partyColorMap, partyNameMap);
}

function buildHouseOrCommons(
  reps: ElectedOfficial[],
  partyColorMap: Map<string, string>,
  partyNameMap: Map<string, string>
): Record<string, MapHouseState> {
  const byState = new Map<string, ElectedOfficial[]>();
  for (const r of reps) {
    if (!r.state) continue;
    const list = byState.get(r.state) ?? [];
    list.push(r);
    byState.set(r.state, list);
  }
  const result: Record<string, MapHouseState> = {};
  for (const [stateId, list] of byState.entries()) {
    const seatsByParty = new Map<string, number>();
    let total = 0;
    for (const r of list) {
      const seats = r.seatsHeld ?? 1;
      const pId = r.party ?? "independent";
      seatsByParty.set(pId, (seatsByParty.get(pId) ?? 0) + seats);
      total += seats;
    }
    if (total === 0) continue;
    const sorted = [...seatsByParty.entries()].sort((a, b) => b[1] - a[1]);
    const [topParty, topSeats] = sorted[0];
    const runnerUp = sorted[1]?.[1] ?? 0;
    const name = partyNameMap.get(topParty) ?? topParty;
    result[stateId] = {
      leadingParty: topParty,
      leadColor: partyColorMap.get(topParty) ?? partyColor(topParty),
      seats: topSeats,
      total,
      tooltip: [
        `${name}: ${topSeats} / ${total} seats`,
        ...(runnerUp > 0 ? [`Lead: +${topSeats - runnerUp}`] : []),
        ...sorted.map(([pId, s]) => `${partyNameMap.get(pId) ?? pId}: ${s}`),
      ],
    };
  }
  return result;
}

function buildCommonsUK(
  mps: ElectedOfficial[],
  partyColorMap: Map<string, string>,
  partyNameMap: Map<string, string>
): Record<string, MapHouseState> {
  const byState = new Map<string, ElectedOfficial[]>();
  for (const mp of mps) {
    if (!mp.state) continue;
    const list = byState.get(mp.state) ?? [];
    list.push(mp);
    byState.set(mp.state, list);
  }
  const result: Record<string, MapHouseState> = {};
  for (const region of UK_REGIONS) {
    const stateId = region.id;
    const list = byState.get(stateId) ?? [];
    const seatsByParty = new Map<string, number>();
    let total = 0;
    for (const r of list) {
      const seats = r.seatsHeld ?? 1;
      const pId = r.party ?? "independent";
      seatsByParty.set(pId, (seatsByParty.get(pId) ?? 0) + seats);
      total += seats;
    }
    const regionName = region.name;
    const totalConst = region.constituencies;
    if (total === 0) {
      result[region.id] = {
        leadingParty: "",
        leadColor: VACANT_COLOR,
        seats: 0,
        total: totalConst,
        tooltip: [regionName, `${totalConst} constituencies`, "No MPs elected yet"],
      };
      continue;
    }
    const sorted = [...seatsByParty.entries()].sort((a, b) => b[1] - a[1]);
    const [topParty, topSeats] = sorted[0];
    const runnerUp = sorted[1]?.[1] ?? 0;
    const name = partyNameMap.get(topParty) ?? topParty;
    result[region.id] = {
      leadingParty: topParty,
      leadColor: partyColorMap.get(topParty) ?? partyColor(topParty),
      seats: topSeats,
      total,
      tooltip: [
        regionName,
        `${name}: ${topSeats} / ${total} MPs`,
        ...(runnerUp > 0 ? [`Lead: +${topSeats - runnerUp}`] : []),
        ...sorted.map(([pId, s]) => `${partyNameMap.get(pId) ?? pId}: ${s}`),
      ],
    };
  }
  return result;
}
