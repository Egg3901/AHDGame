/**
 * NG presiding-officer election action handlers — parallel of the DE
 * Bundestagspräsident handlers (src/lib/congress/bundestagspraesident/actions.ts).
 * Same shape (declare / withdraw / vote / start_election / force_end), same
 * 24-hour window, same `any-seated` eligibility. The only difference is that
 * the handlers are parameterised by role so one module serves both chambers,
 * and the electorate is the seated members of the matching chamber (officeType
 * "house" for the Speaker, "senate" for the Senate President). NPPs do not
 * participate.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { parseObjectId } from "@/lib/utils/objectId";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import {
  buildChamberLeadershipContext,
  describeEligibility,
  isPartyEligible,
  POLICY_BY_ROLE,
} from "@/lib/congress/leadership/rolePolicy";
import type {
  NgChamberLeadershipElection,
  NgChamberLeadershipNomination,
  NgChamberLeadershipRole,
  Character,
  ElectedOfficial,
  PoliticalParty,
} from "@/lib/db/types";
import { NG_ROLE_CONFIG, NG_ELECTION_COLLECTION, NG_NOMINATION_COLLECTION } from "./config";
import { getNgChamberComposition } from "./composition";
import { resolveNgChamberLeadershipElection } from "./resolveElection";

const ELECTION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours — parity with DE/US

export type ActionResult =
  | { success: true; message: string; status?: number }
  | { success: false; error: string; status: number };

export interface ActionContext {
  db: Db;
  partyMap: Map<string, PoliticalParty>;
  role: NgChamberLeadershipRole;
  authUser: { userId: string; isAdmin?: boolean };
  action: string;
  nominationId?: string;
}

export async function handleNgChamberLeadershipAction(ctx: ActionContext): Promise<ActionResult> {
  const { action } = ctx;

  if (action === "start_election") return handleStartElection(ctx);
  if (action === "force_end") return handleForceEnd(ctx);

  const { db, partyMap, role, authUser, nominationId } = ctx;
  const cfg = NG_ROLE_CONFIG[role];

  const character = await db
    .collection<Character>("characters")
    .findOne({ userId: new ObjectId(authUser.userId) });
  if (!character) return { success: false, error: "No character", status: 400 };

  const myOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: character._id,
    officeType: cfg.memberOfficeType,
    countryId: "NG",
  });
  if (!myOfficial) {
    return {
      success: false,
      error: `Only sitting members can participate in the ${cfg.label} election.`,
      status: 403,
    };
  }

  const election = await db
    .collection<NgChamberLeadershipElection>(NG_ELECTION_COLLECTION)
    .findOne({ _id: role });
  const gameTime = await getGameTime();
  const isVoting =
    election?.status === "voting" &&
    !isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow);

  const myParty = character.party ?? "";
  const policy = POLICY_BY_ROLE[role];
  const composition = await getNgChamberComposition(db, partyMap, cfg.memberOfficeType);
  const chamberCtx = buildChamberLeadershipContext({
    composition: composition.composition,
    majorityParty: composition.majorityParty,
    majorityBloc: composition.majorityBloc,
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
        error: `Only ${eligibilityLabel} may declare for ${cfg.label}.`,
        status: 403,
      };
    }
    const existing = await db
      .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
      .findOne({ role, nomineeId: character._id, status: { $in: ["open", "voting"] } });
    if (existing) {
      return { success: false, error: "You already have an open nomination.", status: 409 };
    }
    const now = new Date();
    await db.collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION).insertOne({
      _id: new ObjectId(),
      role,
      nomineeId: character._id,
      nomineeName: character.name ?? "",
      nomineeParty: character.party ?? undefined,
      nomineeCountryId: "NG",
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
    return { success: true, message: `You have declared for ${cfg.label}.` };
  }

  if (action === "withdraw") {
    if (!isVoting) {
      return { success: false, error: "No active election to withdraw from.", status: 409 };
    }
    const result = await db
      .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
      .updateOne(
        { role, nomineeId: character._id, status: { $in: ["open", "voting"] } },
        { $set: { status: "cancelled", updatedAt: new Date() } }
      );
    if (result.matchedCount === 0) {
      return { success: false, error: "No open nomination to withdraw.", status: 404 };
    }
    return { success: true, message: `Withdrawn from the ${cfg.label} election.` };
  }

  if (action === "vote") {
    if (!isVoting) {
      return { success: false, error: "No active election to vote in.", status: 409 };
    }
    if (!isEligibleParty) {
      return {
        success: false,
        error: `Only ${eligibilityLabel} may vote for ${cfg.label}.`,
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
      .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
      .findOne({ _id: oid, role });
    if (!nom || (nom.status !== "open" && nom.status !== "voting")) {
      return { success: false, error: "Nomination not accepting votes.", status: 404 };
    }
    const prior = nom.votes?.[charKey];
    if (prior === "for") {
      return { success: false, error: "You already voted for this nomination.", status: 409 };
    }
    const now = new Date();
    // Move this voter's vote off any prior nomination in this race (one vote per voter).
    await db.collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION).updateMany(
      { role, [`votes.${charKey}`]: { $exists: true } },
      {
        $inc: { votesFor: -1 },
        $unset: { [`votes.${charKey}`]: "" },
        $set: { updatedAt: now },
      }
    );
    await db.collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION).updateOne(
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
  const { db, role, authUser } = ctx;
  const cfg = NG_ROLE_CONFIG[role];
  if (!authUser.isAdmin) {
    return { success: false, error: "Admin only.", status: 403 };
  }
  const existing = await db
    .collection<NgChamberLeadershipElection>(NG_ELECTION_COLLECTION)
    .findOne({ _id: role });
  if (existing?.status === "voting") {
    return { success: false, error: "An election is already in progress.", status: 409 };
  }
  const now = new Date();
  const endsAt = new Date(now.getTime() + ELECTION_DURATION_MS);
  const endsOnTurn = (await getGameTime()).currentTurn + ELECTION_DURATION_MS / 3_600_000;
  // Clear any stale nominations from a prior cycle.
  await db
    .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
    .updateMany(
      { role, status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  await db.collection<NgChamberLeadershipElection>(NG_ELECTION_COLLECTION).updateOne(
    { _id: role },
    {
      $set: {
        _id: role,
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
    message: `${cfg.label} election opened (closes ${endsAt.toISOString()}).`,
  };
}

async function handleForceEnd(ctx: ActionContext): Promise<ActionResult> {
  const { db, role, authUser } = ctx;
  if (!authUser.isAdmin) {
    return { success: false, error: "Admin only.", status: 403 };
  }
  const resolved = await resolveNgChamberLeadershipElection(db, role, true);
  if (!resolved) {
    return { success: false, error: "No open election to end.", status: 409 };
  }
  return { success: true, message: "Election force-ended and resolved." };
}
