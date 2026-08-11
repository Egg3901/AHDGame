/**
 * Speaker election action handlers.
 * Each returns { success, message?, error?, status? } for the route to convert to NextResponse.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { parseObjectId } from "@/lib/utils/objectId";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { getGameTime } from "@/lib/time/gameTime";
import { resolveSpeakerElection } from "./resolveSpeakerElection";
import { resolveSpeakerVacateMotion } from "./resolveVacateMotion";
import { clearWhippedFromVote } from "@/lib/congress/clearWhippedVote";
import {
  describeLeadershipConflict,
  failNominationIfLeadershipConflict,
} from "@/lib/congress/leadershipRaceGuard";
import { castLeadershipVoteBallot } from "@/lib/congress/leadershipVoteBallots";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import type {
  CongressLeader,
  SpeakerElection,
  SpeakerNomination,
  SpeakerVacateMotion,
  HouseLeadershipNomination,
  SenateLeadershipNomination,
  Character,
  ElectedOfficial,
  PoliticalParty,
} from "@/lib/db/types";
import {
  buildChamberLeadershipContext,
  describeEligibility,
  isPartyEligible,
  POLICY_BY_ROLE,
} from "@/lib/congress/leadership/rolePolicy";

const ELECTION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export type ActionResult =
  | { success: true; message: string; status?: number }
  | { success: false; error: string; status: number };

export interface ActionContext {
  db: Db;
  partyMap: Map<string, PoliticalParty>;
  house: Awaited<ReturnType<typeof getHouseComposition>>;
  authUser: { userId: string; isAdmin?: boolean };
  action: string;
  nominationId?: string;
  /** For vote_vacate_motion: "for" = vacate the Speaker, "against" = keep. */
  vacateVote?: "for" | "against";
}

export async function handleSpeakerAction(ctx: ActionContext): Promise<ActionResult> {
  const { db, house, authUser, action, nominationId } = ctx;

  if (action === "start_election") return handleStartElection(ctx);
  if (action === "reset_election") return handleResetElection(ctx);
  if (action === "force_end") return handleForceEnd(ctx);

  // declare, withdraw, vote require character + House membership
  const character = await db.collection<Character>("characters").findOne({
    userId: new ObjectId(authUser.userId),
  });
  if (!character) return { success: false, error: "No character", status: 400 };

  const myOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: character._id,
    officeType: "house",
  });
  if (!myOfficial) {
    return {
      success: false,
      error: "Only sitting House members can participate in Speaker elections.",
      status: 403,
    };
  }

  // Motion to vacate the chair — House-wide, not majority-gated like the election.
  if (action === "file_vacate_motion")
    return handleFileVacateMotion({ ...ctx, character, myOfficial });
  if (action === "vote_vacate_motion") return handleVoteVacateMotion({ ...ctx, character });

  const election = await db
    .collection<SpeakerElection>("speakerElections")
    .findOne({ _id: "current" });
  const gameTimeForVoting = await getGameTime();
  const isVoting =
    election?.status === "voting" &&
    !isLeadershipElectionClosed(
      election,
      gameTimeForVoting.currentTurn,
      gameTimeForVoting.effectiveNow
    );
  const myParty = character.party ?? "";
  const speakerPolicy = POLICY_BY_ROLE.speaker_of_the_house;
  const chamberCtx = buildChamberLeadershipContext({
    composition: house.composition,
    majorityParty: house.majorityParty,
    majorityBloc: house.majorityBloc,
  });
  const isEligibleParty = isPartyEligible(speakerPolicy, myParty, chamberCtx);
  const eligibilityLabel = describeEligibility(speakerPolicy, chamberCtx);

  if (action === "declare")
    return handleDeclare({
      ...ctx,
      character,
      myOfficial,
      election,
      isVoting,
      isEligibleParty,
      eligibilityLabel,
    });
  if (action === "withdraw")
    return handleWithdraw({ ...ctx, character, myOfficial, election, isVoting });
  if (action === "vote")
    return handleVote({
      ...ctx,
      character,
      nominationId: nominationId!,
      election,
      isVoting,
      isEligibleParty,
      eligibilityLabel,
    });

  return { success: false, error: "Invalid action", status: 400 };
}

async function handleStartElection(ctx: ActionContext): Promise<ActionResult> {
  const { db, house, authUser } = ctx;
  if (!authUser.isAdmin) return { success: false, error: "Admin only", status: 403 };

  const existing = await db
    .collection<SpeakerElection>("speakerElections")
    .findOne({ _id: "current" });
  const gameTimeForStart = await getGameTime();
  if (
    existing?.status === "voting" &&
    !isLeadershipElectionClosed(
      existing,
      gameTimeForStart.currentTurn,
      gameTimeForStart.effectiveNow
    )
  ) {
    return { success: false, error: "A Speaker election is already in progress.", status: 409 };
  }

  const now = new Date();
  await db
    .collection<SpeakerNomination>("speakerNominations")
    .updateMany(
      { status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  // Anchor endsAt to the game clock so readers using the same clock can
  // correctly determine when the window closes regardless of real-time drift.
  const endsAt = new Date(gameTimeForStart.effectiveNow.getTime() + ELECTION_DURATION_MS);
  const endsOnTurn = gameTimeForStart.currentTurn + ELECTION_DURATION_MS / 3_600_000;
  await db.collection<SpeakerElection>("speakerElections").updateOne(
    { _id: "current" },
    {
      $set: {
        _id: "current",
        status: "voting",
        startedAt: now,
        endsAt,
        endsOnTurn,
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  const speakerPolicy = POLICY_BY_ROLE.speaker_of_the_house;
  const chamberCtx = buildChamberLeadershipContext({
    composition: house.composition,
    majorityParty: house.majorityParty,
    majorityBloc: house.majorityBloc,
  });

  const incumbent = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: "speaker_of_the_house" });
  if (incumbent?.characterId) {
    const hasSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      officeType: "house",
      characterId: incumbent.characterId,
    });
    if (hasSeat) {
      const char = await db
        .collection<Character>("characters")
        .findOne({ _id: incumbent.characterId }, { projection: { party: 1, homeState: 1 } });
      const party = char?.party ?? incumbent.party ?? null;
      if (char && party && isPartyEligible(speakerPolicy, party, chamberCtx)) {
        await db.collection<SpeakerNomination>("speakerNominations").insertOne({
          _id: new ObjectId(),
          nomineeId: incumbent.characterId,
          nomineeName: incumbent.characterName,
          nomineeParty: party,
          nomineeState: char.homeState ?? undefined,
          nominatedById: incumbent.characterId,
          nominatedByName: "Incumbent",
          status: "voting",
          votesFor: 0,
          votesAgainst: 0,
          votes: {},
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  const eligibilityLabel = describeEligibility(speakerPolicy, chamberCtx);
  return {
    success: true,
    message: `Speaker election started. Voting ends in 24 hours (${endsAt.toISOString()}). Only ${eligibilityLabel} may run and vote. Plurality wins.`,
  };
}

async function handleResetElection(ctx: ActionContext): Promise<ActionResult> {
  const { db, authUser } = ctx;
  if (!authUser.isAdmin) return { success: false, error: "Admin only", status: 403 };

  const now = new Date();
  await db
    .collection<SpeakerNomination>("speakerNominations")
    .updateMany(
      { status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  await db
    .collection<SpeakerElection>("speakerElections")
    .updateOne(
      { _id: "current" },
      { $set: { status: "closed", updatedAt: now } },
      { upsert: true }
    );
  return {
    success: true,
    message: "Speaker election reset. You can start a new 24-hour election.",
  };
}

async function handleForceEnd(ctx: ActionContext): Promise<ActionResult> {
  const { db, partyMap, authUser } = ctx;
  if (!authUser.isAdmin) return { success: false, error: "Admin only", status: 403 };

  const resolved = await resolveSpeakerElection(db, partyMap, true);
  if (resolved) {
    return { success: true, message: "Speaker election ended. Winner or vacancy is set." };
  }
  return { success: false, error: "No active election to end.", status: 409 };
}

async function handleDeclare(
  ctx: ActionContext & {
    character: Character;
    myOfficial: ElectedOfficial;
    election: SpeakerElection | null;
    isVoting: boolean;
    isEligibleParty: boolean;
    eligibilityLabel: string;
  }
): Promise<ActionResult> {
  const { db, character, myOfficial, election, isVoting, isEligibleParty, eligibilityLabel } = ctx;
  if (!isVoting)
    return {
      success: false,
      error: "No Speaker election is currently open for candidacies.",
      status: 409,
    };
  if (!isEligibleParty) {
    return {
      success: false,
      error: `Only ${eligibilityLabel} may run for Speaker.`,
      status: 403,
    };
  }

  const orClause = [
    { nomineeId: character._id },
    myOfficial.nppId && { nomineeId: myOfficial.nppId },
  ].filter(Boolean) as { nomineeId: ObjectId }[];
  const existingSpeaker = await db.collection<SpeakerNomination>("speakerNominations").findOne({
    $or: orClause,
    status: { $in: ["open", "voting"] },
  });
  if (existingSpeaker)
    return { success: false, error: "You already have an active candidacy.", status: 409 };

  const hasOtherHouse = await db
    .collection<HouseLeadershipNomination>("houseLeadershipNominations")
    .findOne({
      nomineeId: character._id,
      status: { $in: ["open", "voting"] },
    });
  if (hasOtherHouse) {
    return {
      success: false,
      error:
        "You can only run for one leadership position at a time. Withdraw from the other race first.",
      status: 409,
    };
  }
  const hasSenate = await db
    .collection<SenateLeadershipNomination>("senateLeadershipNominations")
    .findOne({
      nomineeId: character._id,
      status: { $in: ["open", "voting"] },
    });
  if (hasSenate) {
    return {
      success: false,
      error:
        "You can only run for one leadership position at a time. Withdraw from the other race first.",
      status: 409,
    };
  }

  const now = new Date();
  const nomineeState = myOfficial.state ?? character.homeState ?? undefined;
  const insertedId = new ObjectId();
  await db.collection<SpeakerNomination>("speakerNominations").insertOne({
    _id: insertedId,
    nomineeId: character._id,
    nomineeName: character.name,
    nomineeParty: character.party ?? undefined,
    nomineeState,
    nominatedById: character._id,
    nominatedByName: character.name,
    status: "open",
    votesFor: 0,
    votesAgainst: 0,
    votes: {},
    createdAt: now,
    updatedAt: now,
  });
  const conflict = await failNominationIfLeadershipConflict(db, {
    collectionName: "speakerNominations",
    nominationId: insertedId,
    nomineeId: character._id,
    now,
  });
  if (conflict) {
    return {
      success: false,
      error: describeLeadershipConflict(conflict),
      status: 409,
    };
  }
  try {
    const { awardAchievement } = await import("@/lib/achievements");
    await awardAchievement(character.userId, "speaker_candidate", character._id);
  } catch (e) {
    console.error("Achievement check failed:", e);
  }
  return {
    success: true,
    message: `${character.name} has declared for Speaker. Voting ends ${election?.endsAt?.toISOString() ?? ""}. Top vote-getter wins.`,
    status: 201,
  };
}

async function handleWithdraw(
  ctx: ActionContext & {
    character: Character;
    myOfficial: ElectedOfficial;
    election: SpeakerElection | null;
    isVoting: boolean;
  }
): Promise<ActionResult> {
  const { db, character, isVoting } = ctx;
  if (!isVoting) return { success: false, error: "No active election.", status: 409 };

  const candidacy = await db.collection<SpeakerNomination>("speakerNominations").findOne({
    nomineeId: character._id,
    status: { $in: ["open", "voting"] },
  });
  if (!candidacy) return { success: false, error: "No active candidacy to withdraw.", status: 404 };

  if ((character.politicalInfluence || 0) < 3) {
    return { success: false, error: "Not enough NPI to withdraw (cost: 3 NPI).", status: 403 };
  }

  const now = new Date();
  await db
    .collection<Character>("characters")
    .updateOne({ _id: character._id }, { $inc: { politicalInfluence: -3 } });
  await db.collection("influenceHistory").insertOne({
    characterId: character._id,
    amount: -3,
    reason: "Withdrew from Speaker election",
    createdAt: now,
  });
  await db
    .collection<SpeakerNomination>("speakerNominations")
    .updateOne({ _id: candidacy._id }, { $set: { status: "failed", updatedAt: now } });
  return { success: true, message: "Candidacy withdrawn. 3 NPI deducted." };
}

async function handleVote(
  ctx: ActionContext & {
    character: Character;
    nominationId: string;
    election: SpeakerElection | null;
    isVoting: boolean;
    isEligibleParty: boolean;
    eligibilityLabel: string;
  }
): Promise<ActionResult> {
  const { db, character, nominationId, isVoting, isEligibleParty, eligibilityLabel } = ctx;
  if (!isVoting) return { success: false, error: "Voting is not open or has ended.", status: 409 };
  if (!isEligibleParty) {
    return {
      success: false,
      error: `Only ${eligibilityLabel} may vote in the Speaker election.`,
      status: 403,
    };
  }

  if (!nominationId) return { success: false, error: "nominationId required", status: 400 };
  const nominationOid = parseObjectId(nominationId);
  if (!nominationOid) return { success: false, error: "Invalid nomination ID", status: 400 };

  const nomination = await db.collection<SpeakerNomination>("speakerNominations").findOne({
    _id: nominationOid,
    status: { $in: ["open", "voting"] },
  });
  if (!nomination)
    return { success: false, error: "Candidacy not found or not active.", status: 404 };

  const now = new Date();
  const { previousNominationId } = await castLeadershipVoteBallot(db, {
    ballotCollectionName: "speakerLeadershipBallots",
    nominationCollectionName: "speakerNominations",
    nominationId: nomination._id,
    voterCharacterId: character._id,
    now,
  });

  // Clear the Player-Whip "Whipped" snapshot on whichever nomination
  // now carries the character's vote so the badge disappears.
  await clearWhippedFromVote(db, "speakerNominations", nomination._id, character._id);
  if (previousNominationId && !previousNominationId.equals(nomination._id)) {
    await clearWhippedFromVote(db, "speakerNominations", previousNominationId, character._id);
  }

  return {
    success: true,
    message: `Vote recorded for ${nomination.nomineeName}. Top vote-getter when the window closes wins.`,
  };
}

async function handleFileVacateMotion(
  ctx: ActionContext & { character: Character; myOfficial: ElectedOfficial }
): Promise<ActionResult> {
  const { db, character } = ctx;

  // There must be a sitting Speaker to move against.
  const leader = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: "speaker_of_the_house" });
  if (!leader?.characterId) {
    return { success: false, error: "There is no sitting Speaker to vacate.", status: 409 };
  }

  const gameTime = await getGameTime();
  const existing = await db
    .collection<SpeakerVacateMotion>("speakerVacateMotions")
    .findOne({ _id: "current" });
  if (
    existing?.status === "voting" &&
    !isLeadershipElectionClosed(existing, gameTime.currentTurn, gameTime.effectiveNow)
  ) {
    return { success: false, error: "A motion to vacate is already in progress.", status: 409 };
  }

  const now = new Date();
  const endsAt = new Date(gameTime.effectiveNow.getTime() + ELECTION_DURATION_MS);
  const endsOnTurn = gameTime.currentTurn + ELECTION_DURATION_MS / 3_600_000;
  await db.collection<SpeakerVacateMotion>("speakerVacateMotions").updateOne(
    { _id: "current" },
    {
      $set: {
        _id: "current",
        status: "voting",
        filedById: character._id,
        filedByName: character.name,
        filedByParty: character.party ?? undefined,
        targetSpeakerId: leader.characterId,
        targetSpeakerName: leader.characterName,
        startedAt: now,
        endsAt,
        endsOnTurn,
        // The member filing the motion is counted as voting to vacate.
        votes: { [character._id.toString()]: "for" },
        updatedAt: now,
      },
      $unset: { resolvedAt: "" },
    },
    { upsert: true }
  );
  return {
    success: true,
    message: `Motion to vacate ${leader.characterName} filed. The House has 24 hours to vote; an absolute majority of the chamber carries it.`,
    status: 201,
  };
}

async function handleVoteVacateMotion(
  ctx: ActionContext & { character: Character }
): Promise<ActionResult> {
  const { db, house, character, vacateVote } = ctx;
  if (vacateVote !== "for" && vacateVote !== "against") {
    return { success: false, error: "Vote must be 'for' or 'against'.", status: 400 };
  }

  const motion = await db
    .collection<SpeakerVacateMotion>("speakerVacateMotions")
    .findOne({ _id: "current" });
  const gameTime = await getGameTime();
  const open =
    motion?.status === "voting" &&
    !isLeadershipElectionClosed(motion, gameTime.currentTurn, gameTime.effectiveNow);
  if (!motion || !open) {
    return { success: false, error: "No motion to vacate is currently open.", status: 409 };
  }

  const now = new Date();
  await db
    .collection<SpeakerVacateMotion>("speakerVacateMotions")
    .updateOne(
      { _id: "current" },
      { $set: { [`votes.${character._id.toString()}`]: vacateVote, updatedAt: now } }
    );

  // A carrying vote resolves the motion immediately (vacate + new election).
  const resolved = await resolveSpeakerVacateMotion(db, house);
  return {
    success: true,
    message: resolved
      ? "Vote recorded. The motion to vacate has carried. The chair is vacated."
      : `Vote recorded (${vacateVote === "for" ? "to vacate" : "to keep"} the Speaker).`,
  };
}
