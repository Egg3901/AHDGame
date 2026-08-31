import type { CountryId } from "@/lib/constants/countries";
import type { Db, Filter } from "mongodb";
import type { PoliticalParty, Character, Election } from "@/lib/db/types";
import { getLeanLabel } from "@/lib/utils/demographics";
import { buildCharacterHref } from "@/lib/utils/profileUrls";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

export async function queryParty(
  db: Db,
  params: {
    id: string;
    country: string;
    members?: boolean;
    membersPage?: number;
    membersLimit?: number;
  }
) {
  const {
    id,
    country,
    members: includeMembers = false,
    membersPage = 1,
    membersLimit = 50,
  } = params;
  const seqId = Number(id);

  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(
      (isNaN(seqId)
        ? { _id: id as unknown as PoliticalParty["_id"], countryId: country }
        : { sequentialId: seqId, countryId: country }) as Filter<PoliticalParty>
    );
  if (!party) return null;

  const partySeqStr = String(party.sequentialId);

  const clampedLimit = Math.min(Math.max(membersLimit, 1), 100);
  const skip = (Math.max(membersPage, 1) - 1) * clampedLimit;

  const [officials, topMembers, recentElections, allMembersResult] = await Promise.all([
    db.collection("electedOfficials").find({ party: partySeqStr, countryId: country }).toArray(),
    db
      .collection<Character>("characters")
      .find({ party: partySeqStr, countryId: country } as Filter<Character>)
      .sort({ nationalInfluence: -1 })
      .limit(5)
      .toArray(),
    db
      .collection<Election>("elections")
      .find({ countryId: country, status: { $in: ["completed", "resolved"] } } as Filter<Election>)
      .sort({ endTime: -1 })
      .limit(3)
      .toArray(),
    includeMembers
      ? db
          .collection<Character>("characters")
          .find({ party: partySeqStr, countryId: country } as Filter<Character>)
          .sort({ nationalInfluence: -1 })
          .skip(skip)
          .limit(clampedLimit)
          .toArray()
      : Promise.resolve(null),
  ]);

  const seatCount = officials.length;

  const chairName = party.chairId
    ? ((
        (await db
          .collection<Character>("characters")
          .findOne({ _id: party.chairId }, { projection: { name: 1 } })) as { name?: string } | null
      )?.name ?? null)
    : null;

  const recentElectionResults = recentElections.map((e) => ({
    electionId: e._id.toString(),
    cycle: e.cycle,
    seatsWon: null as number | null,
  }));

  return {
    id: party._id.toString(),
    name: party.name,
    abbreviation: party.abbreviation ?? null,
    color: party.color,
    economicPosition: party.economicPosition ?? 0,
    socialPosition: party.socialPosition ?? 0,
    economicLabel: getLeanLabel(party.economicPosition ?? 0),
    socialLabel: getLeanLabel(party.socialPosition ?? 0),
    memberCount: party.memberCount ?? 0,
    seatCount,
    treasury: party.treasury ?? 0,
    chairName,
    partyUrl: `${BASE_URL}/country/${country}/parties/${party.sequentialId}`,
    recentElectionResults,
    topMembers: topMembers.map((m) => ({
      id: m._id.toString(),
      name: m.name,
      position: ((m.currentOffice as Record<string, unknown> | undefined)?.type as string) ?? null,
      politicalInfluence: m.politicalInfluence ?? 0,
      profileUrl: `${BASE_URL}${buildCharacterHref(m)}`,
    })),
    ...(allMembersResult !== null && {
      members: {
        page: Math.max(membersPage, 1),
        limit: clampedLimit,
        data: allMembersResult.map((m) => ({
          id: m._id.toString(),
          name: m.name,
          role: party.chairId?.toString() === m._id.toString() ? "chair" : null,
          position:
            ((m.currentOffice as Record<string, unknown> | undefined)?.type as string) ?? null,
          nationalInfluence: m.nationalInfluence ?? 0,
          profileUrl: `${BASE_URL}${buildCharacterHref(m)}`,
        })),
      },
    }),
  };
}

/**
 * All parties for a country, ordered by member count. Seat counts come from
 * the country's current legislature composition when available, so the list
 * matches what /country/[code] reports.
 */
export async function queryPartyList(db: Db, params: { country: string }) {
  const cid = params.country.toUpperCase() as CountryId;

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: cid })
    .sort({ memberCount: -1 })
    .toArray();

  if (parties.length === 0) return { found: false, parties: [] as unknown[] };

  // Seat share per party from the elected-officials roster (same source the
  // legislature widgets aggregate), so seats always reconcile with members.
  const seatCounts = new Map<string, number>();
  const officials = db.collection("electedOfficials");
  const rows = await officials
    .aggregate([{ $match: { countryId: cid } }, { $group: { _id: "$party", seats: { $sum: 1 } } }])
    .toArray();
  for (const r of rows) {
    if (r._id != null) seatCounts.set(String(r._id), r.seats);
  }

  return {
    found: true,
    parties: parties.map((p) => ({
      id: p.sequentialId,
      objectId: p._id.toString(),
      name: p.name,
      abbreviation: p.abbreviation ?? null,
      color: p.color,
      economicPosition: p.economicPosition,
      socialPosition: p.socialPosition,
      memberCount: p.memberCount,
      seatCount: seatCounts.get(String(p.sequentialId)) ?? 0,
      treasury: p.treasury ?? null,
      isDefault: p.isDefault ?? false,
    })),
  };
}
