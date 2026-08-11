import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { getPartyMap } from "@/lib/db/partyMap";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { getPartyHex } from "@/lib/utils/politics";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import type {
  CongressLeader,
  HouseLeadershipElection,
  HouseLeadershipElectionRole,
  HouseLeadershipNomination,
  Character,
  ElectedOfficial,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import { computeCongressLeadershipTally } from "@/lib/congress/governmentVoteBreakdown";
import type {
  HouseLeaderDisplay,
  HouseLeaderCandidacyDisplay,
  HouseLeaderElectionState,
} from "@/lib/congress/types";

// Re-export for any code still importing types from this lib file.
// New consumers should import from "@/lib/congress/types" directly.
export type {
  HouseLeaderDisplay,
  HouseLeaderCandidacyDisplay,
  HouseLeaderElectionState,
  HouseLeadershipResponse,
} from "@/lib/congress/types";

const ROLE_TO_LEADER: Record<HouseLeadershipElectionRole, LeadershipRole> = {
  majority_leader: "majority_leader_house",
  minority_leader: "minority_leader_house",
  majority_whip: "majority_whip_house",
  minority_whip: "minority_whip_house",
};

export type LeadershipRole = import("@/lib/db/types").LeadershipRole;

export function vacateHouseLeaderIfLostSeat(db: Db, leaderRole: LeadershipRole): Promise<void> {
  return db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: leaderRole })
    .then(async (leaderDoc) => {
      if (!leaderDoc?.characterId) return;
      const stillHasSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
        officeType: "house",
        $or: [{ characterId: leaderDoc.characterId }, { nppId: leaderDoc.characterId }],
      });
      if (stillHasSeat) return;
      const now = new Date();
      await db
        .collection<CongressLeader>("congressLeaders")
        .updateOne(
          { role: leaderRole },
          { $set: { characterId: null, characterName: "Vacant", updatedAt: now } }
        );
    });
}

export async function resolveHouseLeadershipElection(
  db: Db,
  role: HouseLeadershipElectionRole,
  force = false
): Promise<boolean> {
  const election = await db
    .collection<HouseLeadershipElection>("houseLeadershipElections")
    .findOne({ _id: role });
  if (!election || election.status !== "voting") return false;
  if (!force) {
    const gameTime = await getGameTime();
    if (!isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow))
      return false;
  }

  const now = new Date();
  const candidacies = await db
    .collection<HouseLeadershipNomination>("houseLeadershipNominations")
    .find({ role, status: { $in: ["open", "voting"] } })
    .sort({ votesFor: -1 })
    .toArray();

  const leaderRole = ROLE_TO_LEADER[role];

  if (candidacies.length === 0) {
    const partyMap = await getPartyMap(db, "US");
    const house = await getHouseComposition(db, partyMap);
    const bloc =
      role === "majority_leader" || role === "majority_whip"
        ? house.majorityBloc
        : house.minorityBloc;
    if (bloc) {
      const allNppOfficials = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ officeType: "house", isNPP: true })
        .toArray();
      const nppIds = allNppOfficials
        .map((o) => o.nppId)
        .filter((id): id is ObjectId => id instanceof ObjectId);
      if (nppIds.length > 0) {
        const npps = await db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .toArray();
        const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));
        const inBloc = allNppOfficials.filter((o) => {
          if (!o.nppId) return false;
          const npp = nppMap.get(o.nppId.toString());
          const p = o.party ?? npp?.party ?? null;
          return p != null && bloc.partySlugs.has(p);
        });
        const inDominant = inBloc.filter((o) => {
          const npp = o.nppId ? nppMap.get(o.nppId.toString()) : null;
          const p = o.party ?? npp?.party ?? null;
          return p === bloc.dominantPartySlug;
        });
        const pick = inDominant[0] ?? inBloc[0] ?? null;
        if (pick) {
          const npp = nppMap.get(pick.nppId!.toString());
          const pickedParty = pick.party ?? npp?.party ?? bloc.dominantPartySlug;
          if (npp) {
            await db.collection<CongressLeader>("congressLeaders").updateOne(
              { role: leaderRole },
              {
                $set: {
                  role: leaderRole,
                  characterId: npp._id,
                  characterName: npp.name,
                  party: pickedParty,
                  electedAt: now,
                  updatedAt: now,
                },
                $setOnInsert: { createdAt: now },
              },
              { upsert: true }
            );
          }
        }
      }
    }
    await db
      .collection<HouseLeadershipElection>("houseLeadershipElections")
      .updateOne({ _id: role }, { $set: { status: "closed", updatedAt: now } });
    return true;
  }

  const winner = candidacies[0];
  await db
    .collection<HouseLeadershipNomination>("houseLeadershipNominations")
    .updateOne({ _id: winner._id }, { $set: { status: "confirmed", updatedAt: now } });
  await db
    .collection<HouseLeadershipNomination>("houseLeadershipNominations")
    .updateMany(
      { role, _id: { $ne: winner._id }, status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  await db.collection<CongressLeader>("congressLeaders").updateOne(
    { role: leaderRole },
    {
      $set: {
        role: leaderRole,
        characterId: winner.nomineeId,
        characterName: winner.nomineeName,
        party: winner.nomineeParty,
        nominatedBy: winner.nominatedById,
        electedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  const { markCongressLeadershipHeld } = await import("@/lib/wiki/markCongressLeadership");
  markCongressLeadershipHeld(db, winner.nomineeId.toString(), now).catch((err) =>
    console.error("[HouseLeadership] Failed to mark congress leadership:", err)
  );
  await db
    .collection<HouseLeadershipElection>("houseLeadershipElections")
    .updateOne({ _id: role }, { $set: { status: "closed", updatedAt: now } });
  return true;
}

export async function buildLeaderState(
  db: Db,
  role: HouseLeadershipElectionRole,
  partySlug: string | null,
  partySeats: number,
  partyLabel: string,
  partyMap: Map<string, PoliticalParty>,
  myCharacterId: string | null,
  myParty: string | null,
  isMember: boolean
): Promise<HouseLeaderElectionState> {
  const leaderRole = ROLE_TO_LEADER[role];
  let election = await db
    .collection<HouseLeadershipElection>("houseLeadershipElections")
    .findOne({ _id: role });
  // Use the game clock so endsAt comparisons match turn-based resolution.
  const gameTime = await getGameTime();
  const gameNow = gameTime.effectiveNow;
  if (
    election?.status === "voting" &&
    isLeadershipElectionClosed(election, gameTime.currentTurn, gameNow)
  ) {
    await resolveHouseLeadershipElection(db, role);
    election = await db
      .collection<HouseLeadershipElection>("houseLeadershipElections")
      .findOne({ _id: role });
  }

  const electionStatus = election?.status ?? "none";
  const isVoting =
    electionStatus === "voting" &&
    !!election &&
    !isLeadershipElectionClosed(election, gameTime.currentTurn, gameNow);

  const leaderDoc = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: leaderRole });
  let current: HouseLeaderDisplay | null = null;
  if (leaderDoc?.characterId) {
    const p = partyMap.get(leaderDoc.party ?? "");
    const char = await db
      .collection<Character>("characters")
      .findOne({ _id: leaderDoc.characterId }, { projection: { avatarUrl: 1, homeState: 1 } });
    const npp = char
      ? null
      : await db
          .collection<NPP>("npps")
          .findOne({ _id: leaderDoc.characterId }, { projection: { homeState: 1, avatarUrl: 1 } });
    current = {
      characterId: leaderDoc.characterId.toString(),
      characterName: leaderDoc.characterName,
      avatarUrl: char?.avatarUrl ?? npp?.avatarUrl,
      party: leaderDoc.party ?? "",
      partyName: p?.name ?? leaderDoc.party ?? "—",
      partyColor: getPartyHex(leaderDoc.party ?? "", p?.color),
      state: char?.homeState ?? npp?.homeState,
      electedAt: leaderDoc.electedAt?.toISOString() ?? null,
    };
  }

  const nomDocs = await db
    .collection<HouseLeadershipNomination>("houseLeadershipNominations")
    .find(isVoting ? { role, status: { $in: ["open", "voting"] } } : { role, status: "confirmed" })
    .sort({ votesFor: -1, createdAt: 1 })
    .toArray();

  const nomineeIds = nomDocs.map((n) => n.nomineeId);
  const nomineeChars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: nomineeIds } }, { projection: { _id: 1, avatarUrl: 1 } })
    .toArray();
  const avatarByNominee = new Map(nomineeChars.map((c) => [c._id.toString(), c.avatarUrl]));

  const foundCharIds = new Set(nomineeChars.map((c) => c._id.toString()));
  const nppNomineeIds = nomineeIds.filter((id) => !foundCharIds.has(id.toString()));
  if (nppNomineeIds.length > 0) {
    const nppDocs = await db
      .collection<NPP>("npps")
      .find({ _id: { $in: nppNomineeIds } }, { projection: { _id: 1, avatarUrl: 1 } })
      .toArray();
    for (const npp of nppDocs) {
      avatarByNominee.set(npp._id.toString(), npp.avatarUrl);
    }
  }

  const filteredNoms = nomDocs.filter((n) => n.status !== "confirmed");
  const candidacies: HouseLeaderCandidacyDisplay[] = await Promise.all(
    filteredNoms.map(async (nom) => {
      const p = partyMap.get(nom.nomineeParty ?? "");
      // Seat-scoped one-member-one-vote count feeds both headline and breakdown.
      const tally = await computeCongressLeadershipTally(db, "house", nom.votes);
      return {
        id: nom._id.toString(),
        nomineeId: nom.nomineeId.toString(),
        nomineeName: nom.nomineeName,
        nomineeParty: nom.nomineeParty ?? "",
        nomineePartyName: p?.name ?? nom.nomineeParty ?? "Independent",
        nomineePartyColor: getPartyHex(nom.nomineeParty ?? "", p?.color),
        nomineeState: nom.nomineeState,
        nominatedByName: nom.nominatedByName,
        avatarUrl: avatarByNominee.get(nom.nomineeId.toString()),
        status: nom.status,
        votesFor: tally.votesFor,
        voteByParty: tally.voteByParty.length > 0 ? tally.voteByParty : undefined,
        isMyVote: !!myCharacterId && !!nom.votes?.[myCharacterId],
        isMyCandidate: myCharacterId ? nom.nomineeId.toString() === myCharacterId : false,
      };
    })
  );
  // Re-order by recomputed count so the displayed leader matches the headline.
  candidacies.sort((a, b) => b.votesFor - a.votesFor);

  let myVoteId: string | null = null;
  let myWhippedFromVoteId: string | null = null;
  let myWhippedFromOriginal: string | null = null;
  let hasActiveCandidacy = false;
  for (const nom of nomDocs) {
    if (myCharacterId && nom.votes?.[myCharacterId]) myVoteId = nom._id.toString();
    if (myCharacterId) {
      const wf = nom.whippedFromVote?.[myCharacterId];
      if (wf) {
        myWhippedFromVoteId = nom._id.toString();
        myWhippedFromOriginal = wf;
      }
    }
    if (myCharacterId && nom.nomineeId.toString() === myCharacterId) hasActiveCandidacy = true;
  }

  const isInParty = partySlug != null && myParty === partySlug;

  return {
    current,
    candidacies,
    election: {
      status: electionStatus,
      endsAt: election?.endsAt?.toISOString() ?? null,
      endsOnTurn: election?.endsOnTurn ?? null,
      startedAt: election?.startedAt?.toISOString() ?? null,
    },
    partyLabel,
    partySeats,
    isMember,
    isInParty,
    hasActiveCandidacy,
    myVoteId,
    myWhippedFromVoteId,
    myWhippedFromOriginal,
  };
}
