import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId, type ClientSession } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { HEX_OBJECT_ID_REGEX } from "@/lib/utils/objectIdHex";
import { handleRouteError } from "@/lib/api/errors";
import { ELECTION_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { isPrimaryEnded } from "@/lib/elections/phases";
import { getGameTime } from "@/lib/time/gameTime";
import { getElectoralVoteUnits } from "@/lib/constants/states";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getOpsBranchMagnitude } from "@/lib/campaigns/upgradeCosts";
import { liveActionFilter } from "@/lib/elections/primaryStateActions";
import { emitStateAttackWire } from "@/lib/elections/raceWireEmit";
import {
  PRIMARY_LOCAL_ATTACK_COST_ACTIONS,
  PRIMARY_LOCAL_ATTACK_COST_FUNDS,
  PRIMARY_LOCAL_ATTACK_FAV_PER_TURN,
  PRIMARY_STATE_ATTACK_DURATION_TURNS,
} from "@/lib/electionEngine/constants";
import type {
  Campaign,
  Character,
  ElectionCandidate,
  GameState,
  PrimaryStateAction,
  State,
} from "@/lib/db/types";

const schema = z.object({
  targetCandidateId: z.string().regex(HEX_OBJECT_ID_REGEX, "Invalid candidate ID format"),
  stateId: z.string().length(2),
  /**
   * Only the kind that has engine maths behind it. Phase 2 widens this; until
   * then, accepting a kind nothing reads would charge a player for nothing,
   * which is exactly what the home-state surge did for months.
   */
  kind: z.literal("localFavorability"),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/elections/[id]/state-attack — open a local attack on one rival in
// one state for the rest of its duration. Charges the character's actions and
// the campaign's funds.
// Auth: requireAuthWithCharacter (must be an active candidate in the primary)
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    // This one IS an action, so it shares the action budget, unlike the GET.
    const limit = checkRateLimit(
      `election:${auth.user.userId}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { targetCandidateId, stateId } = parsed.data;

    const { id: electionParam } = await params;
    const db = await getDb();

    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } });
    const validStates = new Set(getElectoralVoteUnits(gameState?.preset).map((u) => u.stateId));
    if (!validStates.has(stateId)) {
      return NextResponse.json({ error: "Invalid US state code" }, { status: 400 });
    }

    const resolved = await resolveElectionRouteParam(db, electionParam);
    if (!resolved.ok) {
      return resolved.reason === "invalid_id"
        ? NextResponse.json({ error: "Invalid election ID" }, { status: 400 })
        : NextResponse.json({ error: "Election not found" }, { status: 404 });
    }
    const election = resolved.election;

    if (election.electionType !== "president" || election.countryId !== "US") {
      return NextResponse.json(
        { error: "State attacks are only available in US presidential primaries" },
        { status: 400 }
      );
    }
    if (election.status !== "active") {
      return NextResponse.json({ error: "Election is not active" }, { status: 400 });
    }

    const gameTime = await getGameTime();
    const currentTurn = gameTime.currentTurn;
    if (isPrimaryEnded(election, currentTurn, gameTime)) {
      return NextResponse.json(
        { error: "State attacks are only available during the primary phase" },
        { status: 400 }
      );
    }

    const character = auth.user.character;

    const actor = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: election._id,
      characterId: character._id,
      status: "active",
    });
    if (!actor) {
      return NextResponse.json(
        { error: "You are not an active candidate in this election" },
        { status: 403 }
      );
    }
    if (actor._id.toString() === targetCandidateId) {
      return NextResponse.json({ error: "You cannot attack yourself" }, { status: 400 });
    }

    const target = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      _id: new ObjectId(targetCandidateId),
      electionId: election._id,
      status: "active",
    });
    if (!target) {
      return NextResponse.json({ error: "That candidate is not in this race" }, { status: 404 });
    }
    // A primary is intra-party, and the projection an attack feeds is built per
    // party, so an attack across the party line has nowhere to land.
    if (target.party !== actor.party) {
      return NextResponse.json(
        { error: "You can only attack a rival in your own primary" },
        { status: 400 }
      );
    }

    const already = await db.collection<PrimaryStateAction>("primaryStateActions").findOne({
      ...liveActionFilter(election._id, currentTurn),
      actorCandidateId: actor._id,
      targetCandidateId: target._id,
      stateId,
      kind: "localFavorability",
    });
    if (already) {
      return NextResponse.json(
        { error: "You already have an attack running on them there" },
        { status: 409 }
      );
    }

    const campaign = await db
      .collection<Campaign>("campaigns")
      .findOne({ electionId: election._id, candidateId: character._id });
    if (!campaign) {
      return NextResponse.json({ error: "You have no campaign in this race" }, { status: 403 });
    }
    if ((campaign.funds ?? 0) < PRIMARY_LOCAL_ATTACK_COST_FUNDS) {
      return NextResponse.json(
        {
          error: `Not enough campaign funds. A local attack costs $${PRIMARY_LOCAL_ATTACK_COST_FUNDS.toLocaleString("en-US")}.`,
        },
        { status: 400 }
      );
    }
    const freshChar = await db
      .collection<Character>("characters")
      .findOne({ _id: character._id }, { projection: { actions: 1 } });
    if (!freshChar || freshChar.actions < PRIMARY_LOCAL_ATTACK_COST_ACTIONS) {
      return NextResponse.json(
        {
          error: `Not enough actions. A local attack costs ${PRIMARY_LOCAL_ATTACK_COST_ACTIONS}.`,
        },
        { status: 400 }
      );
    }

    // The target's Rapid Response, stamped onto the row now so a later retune
    // of their tree cannot rewrite an attack already paid for.
    const targetCampaign = await db
      .collection<Campaign>("campaigns")
      .findOne({ electionId: election._id, candidateId: target.characterId });
    const shieldTree = targetCampaign?.mediaSpendingTree;
    const shieldApplied =
      shieldTree?.starter && shieldTree.c > 0
        ? getOpsBranchMagnitude("mediaSpending", "c", shieldTree.c)
        : 0;

    const now = new Date();
    const row: Omit<PrimaryStateAction, "_id"> = {
      electionId: election._id,
      actorCandidateId: actor._id,
      targetCandidateId: target._id,
      targetCharacterId: target.characterId,
      stateId,
      kind: "localFavorability",
      magnitude: PRIMARY_LOCAL_ATTACK_FAV_PER_TURN,
      shieldApplied,
      appliedTurn: currentTurn,
      expiresTurn: currentTurn + PRIMARY_STATE_ATTACK_DURATION_TURNS,
      createdAt: now,
    };

    const debit = async (session?: ClientSession) => {
      const opts = session ? { session } : {};
      const charDebit = await db
        .collection<Character>("characters")
        .updateOne(
          { _id: character._id, actions: { $gte: PRIMARY_LOCAL_ATTACK_COST_ACTIONS } },
          { $inc: { actions: -PRIMARY_LOCAL_ATTACK_COST_ACTIONS }, $set: { updatedAt: now } },
          opts
        );
      if (charDebit.modifiedCount === 0) throw new Error("INSUFFICIENT_RESOURCES");

      const campDebit = await db
        .collection<Campaign>("campaigns")
        .updateOne(
          { _id: campaign._id, funds: { $gte: PRIMARY_LOCAL_ATTACK_COST_FUNDS } },
          { $inc: { funds: -PRIMARY_LOCAL_ATTACK_COST_FUNDS }, $set: { updatedAt: now } },
          opts
        );
      if (campDebit.modifiedCount === 0) throw new Error("INSUFFICIENT_RESOURCES");

      await db
        .collection<PrimaryStateAction>("primaryStateActions")
        .insertOne(row as PrimaryStateAction, opts);
    };

    try {
      await runWithOptionalTransaction(
        (session) => debit(session),
        () => debit()
      );
    } catch (error) {
      if ((error as Error).message === "INSUFFICIENT_RESOURCES") {
        return NextResponse.json(
          { error: "Your actions or campaign funds changed. Please try again." },
          { status: 409 }
        );
      }
      throw error;
    }

    const stateName =
      (await db.collection<State>("states").findOne({ _id: stateId }, { projection: { name: 1 } }))
        ?.name ?? stateId;

    void emitStateAttackWire(
      election._id,
      character.name,
      target.characterName ?? "a rival",
      stateName
    );

    return NextResponse.json({
      success: true,
      message: `Local attack opened on ${target.characterName ?? "your rival"} in ${stateName}. It runs for ${PRIMARY_STATE_ATTACK_DURATION_TURNS} turns.`,
      expiresTurn: row.expiresTurn,
      shieldApplied,
    });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/elections/[id]/state-attack" });
  }
}
