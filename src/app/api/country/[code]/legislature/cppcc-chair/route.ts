/**
 * GET  /api/country/cn/legislature/cppcc-chair
 *   Returns current Chairman of the CPPCC, active election (24h window), and
 *   open nominations. Auto-resolves an expired election (parity with US Speaker).
 *
 * POST /api/country/cn/legislature/cppcc-chair
 *   Actions: declare | withdraw | vote | start_election (admin) | force_end (admin).
 *
 * Mirror of the NPCSC Chair route, modeled on the US House Majority Leader:
 * `largest-single-party` eligibility — only the largest NPC party (the CCP)
 * may declare/vote. The electorate is the CCP's seated NPC delegates.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getPartyMap } from "@/lib/db/partyMap";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getAuthUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getNpcComposition } from "@/lib/congress/npcComposition";
import { resolveCppccChairElection } from "@/lib/congress/cppccChair/resolveElection";
import { handleCppccChairAction } from "@/lib/congress/cppccChair/actions";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  buildChamberLeadershipContext,
  describeEligibility,
  isPartyEligible,
  POLICY_BY_ROLE,
} from "@/lib/congress/leadership/rolePolicy";
import type {
  CppccChairElection,
  CppccChairNomination,
  Character,
  CongressLeader,
  ElectedOfficial,
} from "@/lib/db/types";

const cppccChairActionSchema = z.object({
  action: z.enum(["declare", "withdraw", "vote", "start_election", "force_end"]),
  nominationId: z.string().optional(),
});

// GET — Returns current CPPCC Chairman, election state, and nominations.
// Auth: public
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase();
    if (countryId !== "CN" || !COUNTRY_CONFIGS.CN) {
      return NextResponse.json({ error: "CPPCC Chairman endpoint is CN-only" }, { status: 400 });
    }
    const db = await getDb();
    const partyMap = await getPartyMap(db, "CN");
    const npc = await getNpcComposition(db, partyMap);
    const authUser = await getAuthUser().catch(() => null);

    let myCharacterId: string | null = null;
    let myParty: string | null = null;
    let isSittingDelegate = false;
    if (authUser) {
      const char = await db
        .collection<Character>("characters")
        .findOne({ userId: new ObjectId(authUser.userId) });
      if (char) {
        myCharacterId = char._id.toString();
        myParty = char.party ?? null;
        const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
          characterId: char._id,
          officeType: "npcDelegate",
          countryId: "CN",
        });
        isSittingDelegate = !!official;
      }
    }

    // Auto-resolve an expired election before responding (parity with US Speaker GET).
    const electionDoc = await db
      .collection<CppccChairElection>("cppccChairElections")
      .findOne({ _id: "current" });
    if (electionDoc?.status === "voting") {
      const gameTime = await getGameTime();
      if (isLeadershipElectionClosed(electionDoc, gameTime.currentTurn, gameTime.effectiveNow)) {
        await resolveCppccChairElection(db, partyMap);
      }
    }

    const [leader, election, nominations] = await Promise.all([
      db.collection<CongressLeader>("congressLeaders").findOne({ role: "chair_cppcc" }),
      db.collection<CppccChairElection>("cppccChairElections").findOne({ _id: "current" }),
      db
        .collection<CppccChairNomination>("cppccChairNominations")
        .find({ status: { $in: ["open", "voting"] } })
        .sort({ votesFor: -1 })
        .toArray(),
    ]);

    const policy = POLICY_BY_ROLE.chair_cppcc;
    const chamberCtx = buildChamberLeadershipContext({
      composition: npc.composition,
      majorityParty: npc.majorityParty,
      majorityBloc: npc.majorityBloc,
    });
    const canRun = myParty != null && isPartyEligible(policy, myParty, chamberCtx);
    const eligibilityLabel = describeEligibility(policy, chamberCtx);

    // Characters store `party` as the country's party sequentialId; resolve it
    // to the party's abbreviation so the panel shows a country-appropriate label.
    const resolvePartyLabel = (party: string | null | undefined): string | null => {
      if (!party) return null;
      const p = partyMap.get(party);
      return p?.abbreviation ?? p?.name ?? party;
    };

    return NextResponse.json({
      leader: leader
        ? {
            characterId: leader.characterId?.toString() ?? null,
            characterName: leader.characterName,
            party: resolvePartyLabel(leader.party),
          }
        : null,
      election: election
        ? {
            status: election.status,
            startedAt: election.startedAt,
            endsAt: election.endsAt,
            endsOnTurn: election.endsOnTurn ?? null,
          }
        : null,
      nominations: nominations.map((n) => ({
        _id: n._id.toString(),
        nomineeId: n.nomineeId.toString(),
        nomineeName: n.nomineeName,
        nomineeParty: resolvePartyLabel(n.nomineeParty),
        votesFor: n.votesFor,
        status: n.status,
        myVote: myCharacterId ? (n.votes?.[myCharacterId] ?? null) : null,
      })),
      canRun,
      eligibilityLabel,
      viewer: {
        characterId: myCharacterId,
        party: myParty,
        isSittingDelegate,
        isAdmin: authUser?.isAdmin ?? false,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST — declare | withdraw | vote | start_election | force_end
// Auth: requireBasicAuth
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase();
    if (countryId !== "CN" || !COUNTRY_CONFIGS.CN) {
      return NextResponse.json({ error: "CPPCC Chairman endpoint is CN-only" }, { status: 400 });
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, cppccChairActionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action, nominationId } = parsed.data;

    const db = await getDb();
    const partyMap = await getPartyMap(db, "CN");
    const npc = await getNpcComposition(db, partyMap);

    const result = await handleCppccChairAction({
      db,
      partyMap,
      npc,
      authUser: {
        userId: auth.user.userId.toString(),
        isAdmin: auth.user.isAdmin ?? false,
      },
      action,
      nominationId,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ message: result.message });
  } catch (error) {
    return handleRouteError(error);
  }
}
