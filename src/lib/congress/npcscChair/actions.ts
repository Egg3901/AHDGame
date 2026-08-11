/**
 * NPC Standing Committee Chairman election action handlers — CN parallel of
 * `src/lib/congress/bundestagspraesident/actions.ts`. Same shape (declare /
 * withdraw / vote / start_election / force_end), same 24-hour voting window.
 * Eligibility follows the role's RoleEligibilityPolicy — `any-seated`, meaning
 * any seated NPC delegate may declare and vote. NPPs do not nominate or vote.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { parseObjectId } from "@/lib/utils/objectId";
import { getNpcComposition } from "@/lib/congress/npcComposition";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { resolveNpcscChairElection } from "./resolveElection";
import type {
  NpcscChairElection,
  NpcscChairNomination,
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
  npc: Awaited<ReturnType<typeof getNpcComposition>>;
  authUser: { userId: string; isAdmin?: boolean };
  action: string;
  nominationId?: string;
}

export async function handleNpcscChairAction(ctx: ActionContext): Promise<ActionResult> {
  const { action } = ctx;

  if (action === "start_election") return handleStartElection(ctx);
  if (action === "force_end") return handleForceEnd(ctx);

  // declare, withdraw, vote require character + NPC membership
  const { db, npc, authUser, nominationId } = ctx;
  const character = await db.collection<Character>("characters").findOne({
    userId: new ObjectId(authUser.userId),
  });
  if (!character) return { success: false, error: "No character", status: 400 };

  const myOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: character._id,
    officeType: "npcDelegate",
    countryId: "CN",
  });
  if (!myOfficial) {
    return {
      success: false,
      error: "Only sitting NPC delegates can participate in Chairman elections.",
      status: 403,
    };
  }

  const election = await db
    .collection<NpcscChairElection>("npcscChairElections")
    .findOne({ _id: "current" });
  const gameTime = await getGameTime();
  const isVoting =
    election?.status === "voting" &&
    !isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow);
  const myParty = character.party ?? "";
  const policy = POLICY_BY_ROLE.chair_npcsc;
  const chamberCtx = buildChamberLeadershipContext({
    composition: npc.composition,
    majorityParty: npc.majorityParty,
    majorityBloc: npc.majorityBloc,
  });
  const isEligibleParty = isPartyEligible(policy, myParty, chamberCtx);
  const eligibilityLabel = describeEligibility(policy, chamberCtx);

  if (action === "declare") {
    if (!isVoting) {
      return { success: false, error: "No active election to declare in.", status: 409 };
    }
    if (!isEligibleParty) {
      return {
        success: false,
        error: `Only ${eligibilityLabel} may declare for Chairman of the NPC Standing Committee.`,
        status: 403,
      };
    }
    const existing = await db
      .collection<NpcscChairNomination>("npcscChairNominations")
      .findOne({ nomineeId: character._id, status: { $in: ["open", "voting"] } });
    if (existing) {
      return { success: false, error: "You already have an open nomination.", status: 409 };
    }
    const now = new Date();
    await db.collection<NpcscChairNomination>("npcscChairNominations").insertOne({
      _id: new ObjectId(),
      nomineeId: character._id,
      nomineeName: character.name ?? "",
      nomineeParty: character.party ?? undefined,
      nomineeCountryId: "CN",
      nomineeState: myOfficial.state,
      nominatedById: character._id,
      nominatedByName: character.name ?? "",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: now,
      updatedAt: now,
    });
    return {
      success: true,
      message: "You have declared for Chairman of the NPC Standing Committee.",
    };
  }

  if (action === "withdraw") {
    if (!isVoting) {
      return { success: false, error: "No active election to withdraw from.", status: 409 };
    }
    const result = await db
      .collection<NpcscChairNomination>("npcscChairNominations")
      .updateOne(
        { nomineeId: character._id, status: { $in: ["open", "voting"] } },
        { $set: { status: "cancelled", updatedAt: new Date() } }
      );
    if (result.matchedCount === 0) {
      return { success: false, error: "No open nomination to withdraw.", status: 404 };
    }
    return { success: true, message: "Withdrawn from the Chairman election." };
  }

  if (action === "vote") {
    if (!isVoting) {
      return { success: false, error: "No active election to vote in.", status: 409 };
    }
    if (!isEligibleParty) {
      return {
        success: false,
        error: `Only ${eligibilityLabel} may vote for Chairman of the NPC Standing Committee.`,
        status: 403,
      };
    }
    if (!nominationId) {
      return { success: false, error: "Missing nomination id.", status: 400 };
    }
    const oid = parseObjectId(nominationId);
    if (!oid) return { success: false, error: "Invalid nomination id.", status: 400 };
    const charKey = character._id.toString();
    const nom = await db
      .collection<NpcscChairNomination>("npcscChairNominations")
      .findOne({ _id: oid });
    if (!nom || (nom.status !== "open" && nom.status !== "voting")) {
      return { success: false, error: "Nomination not accepting votes.", status: 404 };
    }
    const prior = nom.votes?.[charKey];
    if (prior === "for") {
      return { success: false, error: "You already voted for this nomination.", status: 409 };
    }
    const now = new Date();
    // Move this voter's vote off any prior nomination (one vote per voter).
    await db.collection<NpcscChairNomination>("npcscChairNominations").updateMany(
      { [`votes.${charKey}`]: { $exists: true } },
      {
        $inc: { votesFor: -1 },
        $unset: { [`votes.${charKey}`]: "" },
        $set: { updatedAt: now },
      }
    );
    await db.collection<NpcscChairNomination>("npcscChairNominations").updateOne(
      { _id: oid },
      {
        $inc: { votesFor: 1 },
        $set: { [`votes.${charKey}`]: "for", status: "voting", updatedAt: now },
      }
    );
    return { success: true, message: "Vote recorded." };
  }

  return { success: false, error: `Unknown action: ${action}`, status: 400 };
}

async function handleStartElection(ctx: ActionContext): Promise<ActionResult> {
  const { db, authUser } = ctx;
  if (!authUser.isAdmin) {
    return { success: false, error: "Admin only.", status: 403 };
  }
  const existing = await db
    .collection<NpcscChairElection>("npcscChairElections")
    .findOne({ _id: "current" });
  if (existing?.status === "voting") {
    return { success: false, error: "An election is already in progress.", status: 409 };
  }
  const now = new Date();
  const endsAt = new Date(now.getTime() + ELECTION_DURATION_MS);
  const endsOnTurn = (await getGameTime()).currentTurn + ELECTION_DURATION_MS / 3_600_000;
  // Clear any stale nominations from a prior cycle.
  await db
    .collection<NpcscChairNomination>("npcscChairNominations")
    .updateMany(
      { status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  await db.collection<NpcscChairElection>("npcscChairElections").updateOne(
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
  return {
    success: true,
    message: `Chairman of the NPC Standing Committee election opened (closes ${endsAt.toISOString()}).`,
  };
}

async function handleForceEnd(ctx: ActionContext): Promise<ActionResult> {
  const { db, partyMap, authUser } = ctx;
  if (!authUser.isAdmin) {
    return { success: false, error: "Admin only.", status: 403 };
  }
  const resolved = await resolveNpcscChairElection(db, partyMap, true);
  if (!resolved) {
    return { success: false, error: "No open election to end.", status: 409 };
  }
  return { success: true, message: "Election force-ended and resolved." };
}
