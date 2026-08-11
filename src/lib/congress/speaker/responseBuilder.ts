import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { getPartyHex } from "@/lib/utils/politics";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { getGameTime } from "@/lib/time/gameTime";
import type { HouseComposition } from "@/lib/congress/houseComposition";
import type {
  CongressLeader,
  SpeakerElection,
  SpeakerNomination,
  SpeakerVacateMotion,
  Character,
  ElectedOfficial,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import type {
  SpeakerDisplay,
  CandidacyDisplay,
  SpeakerResponse,
  VacateMotionDisplay,
} from "./types";
import { vacateThreshold } from "./resolveVacateMotion";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { computeCongressLeadershipTally } from "@/lib/congress/governmentVoteBreakdown";
import { serializeBloc } from "@/lib/congress/blocs";
import {
  buildChamberLeadershipContext,
  describeEligibility,
  isPartyEligible,
  POLICY_BY_ROLE,
} from "@/lib/congress/leadership/rolePolicy";

export interface BuildSpeakerResponseInput {
  db: Db;
  partyMap: Map<string, PoliticalParty>;
  house: HouseComposition;
  authUser: { userId: string; isAdmin?: boolean } | null;
}

export async function buildSpeakerResponse(
  input: BuildSpeakerResponseInput
): Promise<SpeakerResponse> {
  const { db, partyMap, house, authUser } = input;

  let myCharacterId: string | null = null;
  let isHouseMember = false;
  let myParty: string | null = null;

  if (authUser) {
    const char = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(authUser.userId),
    });
    myCharacterId = char?._id?.toString() ?? null;
    myParty = char?.party ?? null;
    if (myCharacterId) {
      const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
        characterId: new ObjectId(myCharacterId),
        officeType: "house",
      });
      isHouseMember = !!official;
    }
  }

  const election = await db
    .collection<SpeakerElection>("speakerElections")
    .findOne({ _id: "current" });
  const electionStatus = election?.status ?? "none";
  // Use the game clock so the voting-window flag matches turn-based resolution.
  const gameTime = await getGameTime();
  const isVoting =
    electionStatus === "voting" &&
    !!election &&
    !isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow);

  const leaderDoc = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: "speaker_of_the_house" });

  let currentSpeaker: SpeakerDisplay | null = null;
  if (leaderDoc?.characterId) {
    const p = partyMap.get(leaderDoc.party ?? "");
    const char = await db
      .collection<Character>("characters")
      .findOne(
        { _id: leaderDoc.characterId },
        { projection: { avatarUrl: 1, homeState: 1, sequentialId: 1, userId: 1 } }
      );
    const npp = char
      ? null
      : await db
          .collection<NPP>("npps")
          .findOne(
            { _id: leaderDoc.characterId },
            { projection: { homeState: 1, avatarUrl: 1, sequentialId: 1 } }
          );
    const speakerBorder = char?.userId
      ? (await fetchBordersByUserIds(db, [char.userId])).get(char.userId.toString())
      : undefined;
    currentSpeaker = {
      characterId: leaderDoc.characterId.toString(),
      sequentialId: char?.sequentialId ?? npp?.sequentialId ?? null,
      characterName: leaderDoc.characterName,
      avatarUrl: char?.avatarUrl ?? npp?.avatarUrl,
      borderKey: speakerBorder?.borderKey ?? null,
      tintColor: speakerBorder?.tintColor ?? null,
      party: leaderDoc.party ?? "",
      partyName: p?.name ?? leaderDoc.party ?? "Independent",
      partyColor: getPartyHex(leaderDoc.party ?? "", p?.color),
      state: char?.homeState ?? npp?.homeState,
      electedAt: leaderDoc.electedAt?.toISOString() ?? null,
      isNPP: !char,
    };
  }

  const nomDocs = await db
    .collection<SpeakerNomination>("speakerNominations")
    .find(isVoting ? { status: { $in: ["open", "voting"] } } : { status: "confirmed" })
    .sort({ votesFor: -1, createdAt: 1 })
    .toArray();

  const nomineeIds = nomDocs.map((n) => n.nomineeId);
  const nomineeChars = await db
    .collection<Character>("characters")
    .find(
      { _id: { $in: nomineeIds } },
      { projection: { _id: 1, avatarUrl: 1, sequentialId: 1, userId: 1 } }
    )
    .toArray();
  const avatarByNominee = new Map(nomineeChars.map((c) => [c._id.toString(), c.avatarUrl]));
  const seqIdByNominee = new Map(nomineeChars.map((c) => [c._id.toString(), c.sequentialId]));

  const nomineeBorderMap = await fetchBordersByUserIds(
    db,
    nomineeChars.map((c) => c.userId)
  );
  const borderByNominee = new Map(
    nomineeChars.map((c) => [c._id.toString(), nomineeBorderMap.get(c.userId.toString())])
  );

  const foundCharIds = new Set(nomineeChars.map((c) => c._id.toString()));
  const nppNomineeIds = nomineeIds.filter((id) => !foundCharIds.has(id.toString()));
  if (nppNomineeIds.length > 0) {
    const nppDocs = await db
      .collection<NPP>("npps")
      .find(
        { _id: { $in: nppNomineeIds } },
        { projection: { _id: 1, avatarUrl: 1, sequentialId: 1 } }
      )
      .toArray();
    for (const npp of nppDocs) {
      avatarByNominee.set(npp._id.toString(), npp.avatarUrl);
      seqIdByNominee.set(npp._id.toString(), npp.sequentialId);
    }
  }

  const filteredSpeakerNoms = nomDocs.filter((n) => n.status !== "confirmed");
  const activeCandidacies: CandidacyDisplay[] = await Promise.all(
    filteredSpeakerNoms.map(async (nom) => {
      const p = partyMap.get(nom.nomineeParty ?? "");
      const nomineeIdStr = nom.nomineeId.toString();
      // Seat-scoped one-member-one-vote count feeds both headline and breakdown.
      const tally = await computeCongressLeadershipTally(db, "house", nom.votes);
      return {
        id: nom._id.toString(),
        nomineeId: nomineeIdStr,
        nomineeSequentialId: seqIdByNominee.get(nomineeIdStr) ?? null,
        nomineeName: nom.nomineeName,
        nomineeParty: nom.nomineeParty ?? "",
        nomineePartyName: p?.name ?? nom.nomineeParty ?? "Independent",
        nomineePartyColor: getPartyHex(nom.nomineeParty ?? "", p?.color),
        nomineeState: nom.nomineeState,
        nominatedByName: nom.nominatedByName,
        avatarUrl: avatarByNominee.get(nomineeIdStr),
        borderKey: borderByNominee.get(nomineeIdStr)?.borderKey ?? null,
        tintColor: borderByNominee.get(nomineeIdStr)?.tintColor ?? null,
        status: nom.status,
        votesFor: tally.votesFor,
        voteByParty: tally.voteByParty.length > 0 ? tally.voteByParty : undefined,
        isMyVote: myCharacterId ? !!nom.votes?.[myCharacterId] : false,
        isMyCandidate: myCharacterId ? nomineeIdStr === myCharacterId : false,
      };
    })
  );
  // Re-order by recomputed count so the displayed leader matches the headline.
  activeCandidacies.sort((a, b) => b.votesFor - a.votesFor);

  let myVoteId: string | null = null;
  let myWhippedFromVoteId: string | null = null;
  let myWhippedFromOriginal: string | null = null;
  let hasActiveCandidacy = false;
  if (myCharacterId) {
    for (const nom of nomDocs) {
      if (nom.votes?.[myCharacterId]) myVoteId = nom._id.toString();
      const wf = nom.whippedFromVote?.[myCharacterId];
      if (wf) {
        myWhippedFromVoteId = nom._id.toString();
        myWhippedFromOriginal = wf;
      }
      if (nom.nomineeId.toString() === myCharacterId) hasActiveCandidacy = true;
    }
  }

  const speakerPolicy = POLICY_BY_ROLE.speaker_of_the_house;
  const chamberCtx = buildChamberLeadershipContext({
    composition: house.composition,
    majorityParty: house.majorityParty,
    majorityBloc: house.majorityBloc,
  });
  const canRunForSpeaker = myParty != null && isPartyEligible(speakerPolicy, myParty, chamberCtx);
  const speakerEligibilityLabel = describeEligibility(speakerPolicy, chamberCtx);
  const isInMajorityBloc =
    myParty != null && (house.majorityBloc?.partySlugs.has(myParty) ?? false);

  // Motion to vacate the chair. Open only when a Speaker is seated and the
  // window hasn't closed; any seated House member may file/vote.
  const motionDoc = await db
    .collection<SpeakerVacateMotion>("speakerVacateMotions")
    .findOne({ _id: "current" });
  const motionOpen =
    motionDoc?.status === "voting" &&
    !isLeadershipElectionClosed(motionDoc, gameTime.currentTurn, gameTime.effectiveNow);
  const motionTally = motionOpen
    ? await computeCongressLeadershipTally(db, "house", motionDoc!.votes)
    : { votesFor: 0, votesAgainst: 0 };
  const vacateMotion: VacateMotionDisplay = {
    status: motionOpen ? "voting" : (motionDoc?.status ?? "none"),
    targetSpeakerName: motionDoc?.targetSpeakerName ?? null,
    filedByName: motionDoc?.filedByName ?? null,
    endsAt: motionOpen ? (motionDoc!.endsAt?.toISOString() ?? null) : null,
    endsOnTurn: motionOpen ? (motionDoc!.endsOnTurn ?? null) : null,
    votesFor: motionTally.votesFor,
    votesAgainst: motionTally.votesAgainst,
    threshold: vacateThreshold(house.totalSeats),
    totalSeats: house.totalSeats,
    myVote: motionOpen && myCharacterId ? (motionDoc!.votes?.[myCharacterId] ?? null) : null,
    // A member can file only when a Speaker is seated, no motion is running, and
    // no Speaker election is in progress.
    canFile: isHouseMember && !!currentSpeaker && !motionOpen && !isVoting,
  };

  return {
    currentSpeaker,
    activeCandidacies,
    vacateMotion,
    election: {
      status: electionStatus,
      endsAt: election?.endsAt?.toISOString() ?? null,
      endsOnTurn: election?.endsOnTurn ?? null,
      startedAt: election?.startedAt?.toISOString() ?? null,
    },
    houseComposition: house.composition,
    majorityBloc: house.majorityBloc ? serializeBloc(house.majorityBloc) : null,
    minorityBloc: house.minorityBloc ? serializeBloc(house.minorityBloc) : null,
    majorityParty: house.majorityParty,
    majoritySeats: house.majoritySeats,
    minorityParty: house.minorityParty,
    minoritySeats: house.minoritySeats,
    isHouseMember,
    canRunForSpeaker,
    speakerEligibilityLabel,
    isInMajorityBloc,
    hasActiveCandidacy,
    myVoteId,
    myWhippedFromVoteId,
    myWhippedFromOriginal,
    isAdmin: authUser?.isAdmin ?? false,
  };
}
