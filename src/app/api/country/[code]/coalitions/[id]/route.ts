import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, notFound, badRequest } from "@/lib/api/errors";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { Character } from "@/lib/db/types/character";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

// GET /api/coalitions/[id]?country=us — Returns full coalition details
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const sequentialId = parseInt(id, 10);
    if (isNaN(sequentialId)) {
      throw badRequest("Coalition ID must be a number.");
    }

    const db = await getDb();

    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId, countryId });

    if (!coalition) {
      throw notFound("Coalition not found");
    }

    // Collect all party ObjectIds: members + pending invites + join requests
    const memberPartyIds = coalition.members.map((m) => m.partyId);
    const invitePartyIds = coalition.pendingInvites.map((i) => i.partyId);
    const requestPartyIds = coalition.joinRequests.map((r) => r.partyId);

    const allPartyIds = [...memberPartyIds, ...invitePartyIds, ...requestPartyIds];

    // Fetch all relevant parties
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ _id: { $in: allPartyIds } })
      .toArray();

    const partyMap = new Map(parties.map((p) => [p._id.toString(), p]));

    // Collect character IDs: member party chairs + coalition chair
    const memberParties = coalition.members.map((m) => partyMap.get(m.partyId.toString()));
    const chairCharacterIds: ObjectId[] = [];

    for (const party of memberParties) {
      if (party?.chairId) {
        chairCharacterIds.push(party.chairId);
      }
    }
    if (coalition.chairCharacterId) chairCharacterIds.push(coalition.chairCharacterId);

    // Fetch all relevant characters (names only)
    const characters = await db
      .collection<Character>("characters")
      .find({ _id: { $in: chairCharacterIds } }, { projection: { _id: 1, name: 1 } })
      .toArray();

    const characterMap = new Map(characters.map((c) => [c._id.toString(), c.name]));

    // Compute live member counts per party (characters + NPPs) using sequentialId
    const validMemberParties = memberParties.filter((p): p is PoliticalParty => p !== undefined);
    const memberSeqIds = validMemberParties.map((p) => String(p.sequentialId));
    const [memberCharCountAgg, memberNppCountAgg] = await Promise.all([
      memberSeqIds.length > 0
        ? db
            .collection<Character>("characters")
            .aggregate<{ _id: string; count: number }>([
              { $match: { party: { $in: memberSeqIds }, countryId } },
              { $group: { _id: "$party", count: { $sum: 1 } } },
            ])
            .toArray()
        : Promise.resolve([]),
      memberSeqIds.length > 0
        ? db
            .collection("npps")
            .aggregate<{ _id: string; count: number }>([
              { $match: { party: { $in: memberSeqIds }, retiredAt: null, countryId } },
              { $group: { _id: "$party", count: { $sum: 1 } } },
            ])
            .toArray()
        : Promise.resolve([]),
    ]);
    const memberCharCounts = new Map(memberCharCountAgg.map((r) => [r._id, r.count]));
    const memberNppCounts = new Map(memberNppCountAgg.map((r) => [r._id, r.count]));

    // Compute averaged economicPosition and socialPosition from member parties
    const partyCount = validMemberParties.length;

    const economicPosition =
      partyCount > 0
        ? Math.round(
            (validMemberParties.reduce((sum, p) => sum + p.economicPosition, 0) / partyCount) * 100
          ) / 100
        : 0;

    const socialPosition =
      partyCount > 0
        ? Math.round(
            (validMemberParties.reduce((sum, p) => sum + p.socialPosition, 0) / partyCount) * 100
          ) / 100
        : 0;

    // Build members list sorted by seniority (joinedAt ascending)
    const sortedMembers = [...coalition.members].sort(
      (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()
    );

    // `chairPartyId` is typed non-null, but production coalitions can carry a
    // null/missing chair party (e.g. the chair party disbanded), which crashed
    // this route with "Cannot read properties of null (reading 'toString')".
    // Treat a missing chair as vacant: no member is flagged coalition chair.
    const coalitionChairPartyIdStr = coalition.chairPartyId?.toString() ?? "";

    const membersResult = sortedMembers.map((member) => {
      const party = partyMap.get(member.partyId.toString());
      const chairId = party?.chairId ?? null;
      const chairName = chairId ? (characterMap.get(chairId.toString()) ?? null) : null;
      const isCoalitionChair = member.partyId.toString() === coalitionChairPartyIdStr;

      const seqIdStr = String(party?.sequentialId ?? member.partySequentialId ?? "");
      return {
        partyId: party?.sequentialId ?? member.partySequentialId,
        partyObjectId: member.partyId.toString(),
        name: party?.name ?? "Unknown Party",
        abbreviation: party?.abbreviation ?? "?",
        color: party?.color ?? "#888888",
        logoUrl: party?.logoUrl ?? null,
        memberCount: seqIdStr
          ? (memberCharCounts.get(seqIdStr) ?? 0) + (memberNppCounts.get(seqIdStr) ?? 0)
          : 0,
        joinedAt: member.joinedAt,
        chairName,
        chairId: chairId?.toString() ?? null,
        isCoalitionChair,
        regimeStatus: party?.regimeStatus ?? null,
      };
    });

    // Enrich pendingInvites with party names (return sequentialId, not ObjectId)
    const pendingInvites = coalition.pendingInvites.map((invite) => {
      const party = partyMap.get(invite.partyId.toString());
      return {
        partyId: party?.sequentialId ?? 0,
        partyName: party?.name ?? "Unknown Party",
        invitedAt: invite.invitedAt,
      };
    });

    // Enrich joinRequests with party names (return sequentialId, not ObjectId)
    const joinRequests = coalition.joinRequests.map((req) => {
      const party = partyMap.get(req.partyId.toString());
      return {
        partyId: party?.sequentialId ?? 0,
        partyName: party?.name ?? "Unknown Party",
        requestedAt: req.requestedAt,
      };
    });

    // Format disbandVote if active
    let disbandVote = null;
    if (coalition.disbandVote) {
      const dv = coalition.disbandVote;
      const yesCount = dv.votes.filter((v) => v.vote === "yes").length;
      const noCount = dv.votes.filter((v) => v.vote === "no").length;

      const votes = dv.votes.map((v) => {
        const votingParty = partyMap.get(v.partyId.toString());
        return {
          partyId: votingParty?.sequentialId ?? null,
          characterId: v.characterId.toString(),
          vote: v.vote,
          votedAt: v.votedAt,
        };
      });

      disbandVote = {
        initiatedAt: dv.initiatedAt,
        expiresAt: dv.expiresAt,
        expiresOnTurn: dv.expiresOnTurn ?? null,
        votes,
        totalMembers: coalition.members.length,
        yesCount,
        noCount,
      };
    }

    // Find chair party sequentialId (chair may be vacant — see note above).
    const chairParty = coalition.chairPartyId
      ? partyMap.get(coalition.chairPartyId.toString())
      : undefined;
    const chairPartySequentialId = chairParty?.sequentialId ?? null;

    const totalMembers = membersResult.reduce((sum, m) => sum + m.memberCount, 0);

    return NextResponse.json({
      id: String(coalition.sequentialId),
      sequentialId: coalition.sequentialId,
      countryId: coalition.countryId,
      name: coalition.name,
      abbreviation: coalition.abbreviation,
      color: coalition.color,
      logoUrl: coalition.logoUrl ?? null,
      discordInviteUrl: coalition.discordInviteUrl ?? null,
      chairPartySequentialId,
      chairCharacterId: coalition.chairCharacterId?.toString() ?? null,
      chairName: coalition.chairCharacterId
        ? (characterMap.get(coalition.chairCharacterId.toString()) ?? "Unknown")
        : "Vacant",
      economicPosition,
      socialPosition,
      members: membersResult,
      pendingInvites,
      joinRequests,
      disbandVote,
      partyCount: coalition.members.length,
      totalMembers,
      createdAt: coalition.createdAt,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
