/** The founding list tier allocates200 seats nationally, independently of constituency winners. */
import { BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";
import { bgNationalOrdinaryQuotas } from "./nationalOrdinaryAllocation";
import { bgBalancedDistrictLists } from "./districtListAllocation";

export interface BgFoundingListBallot {
  districtId: string;
  /** Registered party lists, including registered lists that received zero votes. */
  partyVotes: Readonly<Record<string, number>>;
}
export type BgFoundingListResult =
  | {
      kind: "allocated";
      partySeats: Record<string, number>;
      districtSeats: Record<string, Record<string, number>>;
    }
  | {
      kind: "deferred";
      reason: "no-valid-list-votes" | "no-eligible-list" | "insufficient-district-list-support";
    };

export function countBgFoundingLists(
  ballots: readonly BgFoundingListBallot[]
): BgFoundingListResult {
  const districts = new Map(BG_1990_LIST_DISTRICTS.map((row) => [row.id, row]));
  if (
    ballots.length !== 28 ||
    new Set(ballots.map((row) => row.districtId)).size !== 28 ||
    ballots.some((row) => !districts.has(row.districtId))
  )
    throw new Error("Bulgarian founding lists require all28 districts");
  const partyVotes: Record<string, number> = {};
  let totalValid = BigInt(0);
  for (const ballot of ballots) {
    for (const [party, votes] of Object.entries(ballot.partyVotes)) {
      if (!party || party === "independent" || !Number.isSafeInteger(votes) || votes < 0)
        throw new Error("Invalid Bulgarian founding party list");
      const next = BigInt(partyVotes[party] ?? 0) + BigInt(votes);
      if (next > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error("Bulgarian founding party total exceeds precision");
      partyVotes[party] = Number(next);
      totalValid += BigInt(votes);
    }
  }
  if (totalValid === BigInt(0)) return { kind: "deferred", reason: "no-valid-list-votes" };
  if (totalValid > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Bulgarian founding list total exceeds precision");
  // CEC methodology, Gazette46/1990, sections7 through12:4% of all valid
  // list votes, followed by national D'Hondt. No direct-seat compensation.
  // https://www.ciela.net/svobodna-zona-darjaven-vestnik/document/-15180285/issue/1091/metodika-za-izchislyavane-na-rezultatite-ot-glasuvaneto-po-proportsionalnata-izbiratelna-sistema
  const national = bgNationalOrdinaryQuotas({
    partyVotes,
    totalValidVotes: Number(totalValid),
    totalSeats: 200,
    independentSeats: 0,
  });
  if (national.unallocatedSeats) return { kind: "deferred", reason: "no-eligible-list" };
  const regional = bgBalancedDistrictLists(
    ballots.map((row) => ({
      id: row.districtId,
      seats: districts.get(row.districtId)!.seats,
      partyVotes: row.partyVotes,
    })),
    national.partySeats
  );
  if (regional.kind !== "allocated") return regional;
  return {
    kind: "allocated",
    partySeats: national.partySeats,
    districtSeats: regional.seatsByDistrict,
  };
}
