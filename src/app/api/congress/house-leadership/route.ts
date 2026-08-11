/**
 * GET  /api/congress/house-leadership — current Majority/Minority Leader, elections, candidacies
 * POST /api/congress/house-leadership — start_election (admin) | declare | withdraw | vote
 *
 * Same as Speaker: 24-hour window and plurality wins.
 * House Majority Leader is restricted to the single majority party; Minority Leader remains open to non-majority parties.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getPartyMap } from "@/lib/db/partyMap";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getAuthUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { houseLeadershipActionSchema } from "@/lib/api/schemas/congress";
import { parseObjectId } from "@/lib/utils/objectId";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { clearWhippedFromVote } from "@/lib/congress/clearWhippedVote";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import {
  describeLeadershipConflict,
  failNominationIfLeadershipConflict,
} from "@/lib/congress/leadershipRaceGuard";
import { castLeadershipVoteBallot } from "@/lib/congress/leadershipVoteBallots";
import {
  vacateLeadershipBulkIfLostSeat,
  resolveLeadershipElection,
  clearIneligibleHouseLeadershipNominations,
} from "@/lib/congress/leadershipElections";
import {
  buildLeadershipElectionState,
  type LeaderDisplay,
  type CandidacyDisplay,
} from "@/lib/congress/leadershipState";
import {
  buildChamberLeadershipContext,
  describeEligibility,
  eligiblePartySlugsFor,
  isPartyEligible,
  POLICY_BY_ROLE,
} from "@/lib/congress/leadership/rolePolicy";
import { houseElectionRoleToLeader } from "@/lib/congress/leadership/electionRoleMap";
import type { HouseLeadershipResponse } from "./lib/leadership";
import type {
  CongressLeader,
  HouseLeadershipElection,
  HouseLeadershipElectionRole,
  HouseLeadershipNomination,
  SpeakerNomination,
  SenateLeadershipNomination,
  Character,
  ElectedOfficial,
} from "@/lib/db/types";

const ELECTION_DURATION_MS = 24 * 60 * 60 * 1000;

const ROLE_TO_LABEL: Record<HouseLeadershipElectionRole, string> = {
  majority_leader: "Majority Leader",
  minority_leader: "Minority Leader",
  majority_whip: "Majority Whip",
  minority_whip: "Minority Whip",
};

export type HouseLeaderDisplay = LeaderDisplay;
export type HouseLeaderCandidacyDisplay = CandidacyDisplay;
export type { HouseLeaderElectionState, HouseLeadershipResponse } from "./lib/leadership";

// GET /api/congress/house-leadership — Returns current House Majority and Minority Leaders with election state and composition.
// Auth: public
// Errors: 400
export async function GET() {
  try {
    const db = await getDb();
    const partyMap = await getPartyMap(db, "US");
    const house = await getHouseComposition(db, partyMap);
    const chamberCtx = buildChamberLeadershipContext({
      composition: house.composition,
      majorityParty: house.majorityParty,
      majorityBloc: house.majorityBloc,
    });
    const majorityPartySeats =
      house.composition.find((entry) => entry.party === house.majorityParty)?.seats ?? 0;
    const authUser = await getAuthUser().catch(() => null);

    let myCharacterId: string | null = null;
    let myParty: string | null = null;
    let isHouseMember = false;
    if (authUser) {
      const char = await db.collection<Character>("characters").findOne({
        userId: new ObjectId(authUser.userId),
      });
      myCharacterId = char?._id?.toString() ?? null;
      myParty = char?.party ?? null;
      if (myCharacterId) {
        const off = await db.collection<ElectedOfficial>("electedOfficials").findOne({
          characterId: new ObjectId(myCharacterId),
          officeType: "house",
        });
        isHouseMember = !!off;
      }
    }

    await vacateLeadershipBulkIfLostSeat(db, [
      { leaderRole: "majority_leader_house", chamber: "house" },
      { leaderRole: "minority_leader_house", chamber: "house" },
      { leaderRole: "majority_whip_house", chamber: "house" },
      { leaderRole: "minority_whip_house", chamber: "house" },
    ]);

    await clearIneligibleHouseLeadershipNominations(db, chamberCtx, new Date());

    const roles: Array<{ role: HouseLeadershipElectionRole; partyLabel: string }> = [
      { role: "majority_leader", partyLabel: "Majority Party" },
      { role: "minority_leader", partyLabel: "Non-Majority Parties" },
      { role: "majority_whip", partyLabel: "Majority Party" },
      { role: "minority_whip", partyLabel: "Non-Majority Parties" },
    ];
    const [majorityLeader, minorityLeader, majorityWhip, minorityWhip] = await Promise.all(
      roles.map(({ role, partyLabel }) => {
        const leaderRole = houseElectionRoleToLeader(role);
        const policy = POLICY_BY_ROLE[leaderRole];
        const eligibleSlugs = eligiblePartySlugsFor(policy, chamberCtx);
        const partySeats =
          policy.kind === "any-seated"
            ? house.totalSeats
            : policy.kind === "largest-single-party"
              ? majorityPartySeats
              : Math.max(0, house.totalSeats - house.majoritySeats);
        return buildLeadershipElectionState(
          db,
          role,
          leaderRole,
          "house",
          eligibleSlugs,
          partySeats,
          partyLabel,
          partyMap,
          myCharacterId,
          myParty,
          isHouseMember
        );
      })
    );

    return NextResponse.json({
      majorityLeader,
      minorityLeader,
      majorityWhip,
      minorityWhip,
      houseComposition: house.composition,
      isAdmin: authUser?.isAdmin ?? false,
    } satisfies HouseLeadershipResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/congress/house-leadership — Handles House leadership election actions: start_election, reset_election, force_end, declare, withdraw, or vote.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const rateLimit = checkRateLimit(authUser.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const partyMap = await getPartyMap(db, "US");
    const house = await getHouseComposition(db, partyMap);
    const chamberCtx = buildChamberLeadershipContext({
      composition: house.composition,
      majorityParty: house.majorityParty,
      majorityBloc: house.majorityBloc,
    });

    const parsed = await parseJsonBody(request, houseLeadershipActionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action, role, nominationId } = parsed.data;

    // ── ADMIN: Start / Reset (no need to be a House member) ─────────────────────
    const roleLabel = ROLE_TO_LABEL[role];
    const leaderRole = houseElectionRoleToLeader(role);
    const policy = POLICY_BY_ROLE[leaderRole];
    const electorateLabel = describeEligibility(policy, chamberCtx);

    if (action === "start_election") {
      if (!authUser.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const existing = await db
        .collection<HouseLeadershipElection>("houseLeadershipElections")
        .findOne({ _id: role });
      const gameTimeForStart = await getGameTime();
      if (
        existing?.status === "voting" &&
        !isLeadershipElectionClosed(
          existing,
          gameTimeForStart.currentTurn,
          gameTimeForStart.effectiveNow
        )
      ) {
        return NextResponse.json(
          { error: `A ${roleLabel} election is already in progress.` },
          { status: 409 }
        );
      }
      const now = new Date();
      await db
        .collection<HouseLeadershipNomination>("houseLeadershipNominations")
        .updateMany(
          { role, status: { $in: ["open", "voting"] } },
          { $set: { status: "failed", updatedAt: now } }
        );
      // Anchor endsAt to the game clock so readers using the same clock can
      // correctly determine when the window closes regardless of real-time drift.
      const endsAt = new Date(gameTimeForStart.effectiveNow.getTime() + ELECTION_DURATION_MS);
      await db
        .collection<HouseLeadershipElection>("houseLeadershipElections")
        .updateOne(
          { _id: role },
          { $set: { _id: role, status: "voting", startedAt: now, endsAt, updatedAt: now } },
          { upsert: true }
        );
      const incumbent = await db
        .collection<CongressLeader>("congressLeaders")
        .findOne({ role: leaderRole });
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
          if (char && party && isPartyEligible(policy, party, chamberCtx)) {
            await db.collection<HouseLeadershipNomination>("houseLeadershipNominations").insertOne({
              _id: new ObjectId(),
              role,
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
      return NextResponse.json({
        message: `${roleLabel} election started. Voting ends in 24 hours. Only ${electorateLabel} may run and vote. Plurality wins.`,
      });
    }

    if (action === "reset_election") {
      if (!authUser.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const now = new Date();
      await db
        .collection<HouseLeadershipNomination>("houseLeadershipNominations")
        .updateMany(
          { role, status: { $in: ["open", "voting"] } },
          { $set: { status: "failed", updatedAt: now } }
        );
      await db
        .collection<HouseLeadershipElection>("houseLeadershipElections")
        .updateOne({ _id: role }, { $set: { status: "closed", updatedAt: now } }, { upsert: true });
      return NextResponse.json({
        message: `${roleLabel} election reset. You can start a new 24-hour election.`,
      });
    }

    if (action === "force_end") {
      if (!authUser.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const resolved = await resolveLeadershipElection(db, role, leaderRole, "house", true);
      return NextResponse.json(
        resolved
          ? { message: `${roleLabel} election ended. Winner or vacancy is set.` }
          : { error: "No active election to end." },
        { status: resolved ? 200 : 409 }
      );
    }

    const character = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(authUser.userId),
    });
    if (!character) return NextResponse.json({ error: "No character" }, { status: 400 });

    const myOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: character._id,
      officeType: "house",
    });
    if (!myOfficial) {
      return NextResponse.json({ error: "Only House members may participate." }, { status: 403 });
    }

    const myParty = character.party ?? "";
    const isEligibleParty = isPartyEligible(policy, myParty, chamberCtx);

    const election = await db
      .collection<HouseLeadershipElection>("houseLeadershipElections")
      .findOne({ _id: role });
    const gameTimeForVoting = await getGameTime();
    const isVoting =
      election?.status === "voting" &&
      !isLeadershipElectionClosed(
        election,
        gameTimeForVoting.currentTurn,
        gameTimeForVoting.effectiveNow
      );

    if (action === "declare") {
      if (!isVoting)
        return NextResponse.json({ error: "No election open for candidacies." }, { status: 409 });
      if (!isEligibleParty) {
        return NextResponse.json({ error: `Only ${electorateLabel} may run.` }, { status: 403 });
      }
      const existing = await db
        .collection<HouseLeadershipNomination>("houseLeadershipNominations")
        .findOne({
          nomineeId: character._id,
          status: { $in: ["open", "voting"] },
        });
      if (existing)
        return NextResponse.json(
          { error: "You already have an active candidacy for a House leadership role." },
          { status: 409 }
        );
      const hasSpeaker = await db.collection<SpeakerNomination>("speakerNominations").findOne({
        nomineeId: character._id,
        status: { $in: ["open", "voting"] },
      });
      if (hasSpeaker)
        return NextResponse.json(
          {
            error:
              "You can only run for one leadership position at a time. Withdraw from Speaker first.",
          },
          { status: 409 }
        );
      const hasSenate = await db
        .collection<SenateLeadershipNomination>("senateLeadershipNominations")
        .findOne({
          nomineeId: character._id,
          status: { $in: ["open", "voting"] },
        });
      if (hasSenate)
        return NextResponse.json(
          {
            error:
              "You can only run for one leadership position at a time. Withdraw from the Senate race first.",
          },
          { status: 409 }
        );
      const now = new Date();
      const nomineeState = myOfficial.state ?? character.homeState ?? undefined;
      const insertedId = new ObjectId();
      await db.collection<HouseLeadershipNomination>("houseLeadershipNominations").insertOne({
        _id: insertedId,
        role,
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
        collectionName: "houseLeadershipNominations",
        nominationId: insertedId,
        nomineeId: character._id,
        now,
      });
      if (conflict) {
        return NextResponse.json({ error: describeLeadershipConflict(conflict) }, { status: 409 });
      }
      return NextResponse.json(
        {
          message: `${character.name} has declared for ${roleLabel}. Plurality wins when voting ends.`,
        },
        { status: 201 }
      );
    }

    if (action === "withdraw") {
      if (!isVoting) return NextResponse.json({ error: "No active election." }, { status: 409 });
      const cand = await db
        .collection<HouseLeadershipNomination>("houseLeadershipNominations")
        .findOne({
          role,
          nomineeId: character._id,
          status: { $in: ["open", "voting"] },
        });
      if (!cand)
        return NextResponse.json({ error: "No active candidacy to withdraw." }, { status: 404 });

      // Check if user has enough NPI
      if ((character.politicalInfluence || 0) < 3) {
        return NextResponse.json(
          { error: "Not enough NPI to withdraw (cost: 3 NPI)." },
          { status: 403 }
        );
      }

      const now = new Date();
      // Deduct 3 NPI
      await db
        .collection<Character>("characters")
        .updateOne({ _id: character._id }, { $inc: { politicalInfluence: -3 } });

      // Log transaction
      await db.collection("influenceHistory").insertOne({
        characterId: character._id,
        amount: -3,
        reason: `Withdrew from ${roleLabel} election`,
        createdAt: now,
      });

      await db
        .collection<HouseLeadershipNomination>("houseLeadershipNominations")
        .updateOne({ _id: cand._id }, { $set: { status: "failed", updatedAt: now } });
      return NextResponse.json({ message: "Candidacy withdrawn. 3 NPI deducted." });
    }

    if (action === "vote") {
      if (!isVoting)
        return NextResponse.json({ error: "Voting is not open or has ended." }, { status: 409 });
      if (!isEligibleParty) {
        return NextResponse.json({ error: `Only ${electorateLabel} may vote.` }, { status: 403 });
      }
      const nomId = nominationId;
      if (!nomId) return NextResponse.json({ error: "nominationId required" }, { status: 400 });
      const nominationOid = parseObjectId(nomId);
      if (!nominationOid)
        return NextResponse.json({ error: "Invalid nomination ID" }, { status: 400 });
      const nomination = await db
        .collection<HouseLeadershipNomination>("houseLeadershipNominations")
        .findOne({
          _id: nominationOid,
          role,
          status: { $in: ["open", "voting"] },
        });
      if (!nomination)
        return NextResponse.json({ error: "Candidacy not found or not active." }, { status: 404 });

      const now = new Date();
      const { previousNominationId } = await castLeadershipVoteBallot(db, {
        ballotCollectionName: "houseLeadershipBallots",
        nominationCollectionName: "houseLeadershipNominations",
        nominationId: nomination._id,
        voterCharacterId: character._id,
        role,
        now,
      });

      // Clear the Player Whip snapshot on both the new nomination and any prior one.
      await clearWhippedFromVote(db, "houseLeadershipNominations", nomination._id, character._id);
      if (previousNominationId && !previousNominationId.equals(nomination._id)) {
        await clearWhippedFromVote(
          db,
          "houseLeadershipNominations",
          previousNominationId,
          character._id
        );
      }

      return NextResponse.json({
        message: `Vote recorded for ${nomination.nomineeName}. Plurality wins.`,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return handleRouteError(error);
  }
}
