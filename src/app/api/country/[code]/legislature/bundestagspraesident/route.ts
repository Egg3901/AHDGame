/**
 * GET  /api/country/de/legislature/bundestagspraesident
 *   Returns current Bundestagspräsident, active election (24h window),
 *   and open nominations. Auto-resolves an expired-but-not-yet-resolved
 *   election (mirrors the US Speaker GET behavior).
 *
 * POST /api/country/de/legislature/bundestagspraesident
 *   Actions: declare | withdraw | vote | start_election (admin) | force_end (admin).
 *
 * Mirror of `/api/congress/speaker` for the DE Bundestag — same 24h voting
 * window, same plurality-winner rule, same majority-bloc eligibility. NPPs
 * do not participate.
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
import { getBundestagComposition } from "@/lib/congress/bundestagComposition";
import { resolveBundestagspraesidentElection } from "@/lib/congress/bundestagspraesident/resolveElection";
import { handleBundestagspraesidentAction } from "@/lib/congress/bundestagspraesident/actions";
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
  BundestagspraesidentElection,
  BundestagspraesidentNomination,
  Character,
  CongressLeader,
  ElectedOfficial,
} from "@/lib/db/types";

const bundestagspraesidentActionSchema = z.object({
  action: z.enum(["declare", "withdraw", "vote", "start_election", "force_end"]),
  nominationId: z.string().optional(),
});

// GET — Returns current Bundestagspräsident, election state, and nominations.
// Auth: public
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase();
    if (countryId !== "DE" || !COUNTRY_CONFIGS.DE) {
      return NextResponse.json(
        { error: "Bundestagspräsident endpoint is DE-only" },
        { status: 400 }
      );
    }
    const db = await getDb();
    const partyMap = await getPartyMap(db, "DE");
    const bundestag = await getBundestagComposition(db, partyMap);
    const authUser = await getAuthUser().catch(() => null);

    // Look up the viewer's character — votes are stored keyed by `character._id`
    // (see actions.ts), so we need the character's id to read back myVote. Also
    // used to surface viewerCharacterId / viewerParty / viewerIsSittingMdB to the
    // panel so the panel doesn't have to call /api/auth/me separately.
    let myCharacterId: string | null = null;
    let myParty: string | null = null;
    let isSittingMdB = false;
    if (authUser) {
      const char = await db
        .collection<Character>("characters")
        .findOne({ userId: new ObjectId(authUser.userId) });
      if (char) {
        myCharacterId = char._id.toString();
        myParty = char.party ?? null;
        const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
          characterId: char._id,
          officeType: "bundestag",
          countryId: "DE",
        });
        isSittingMdB = !!official;
      }
    }

    // Auto-resolve an expired election before responding (parity with US Speaker GET).
    const electionDoc = await db
      .collection<BundestagspraesidentElection>("bundestagspraesidentElections")
      .findOne({ _id: "current" });
    if (electionDoc?.status === "voting") {
      const gameTime = await getGameTime();
      if (isLeadershipElectionClosed(electionDoc, gameTime.currentTurn, gameTime.effectiveNow)) {
        await resolveBundestagspraesidentElection(db, partyMap);
      }
    }

    const [leader, election, nominations] = await Promise.all([
      db
        .collection<CongressLeader>("congressLeaders")
        .findOne({ role: "speaker_of_the_bundestag" }),
      db
        .collection<BundestagspraesidentElection>("bundestagspraesidentElections")
        .findOne({ _id: "current" }),
      db
        .collection<BundestagspraesidentNomination>("bundestagspraesidentNominations")
        .find({ status: { $in: ["open", "voting"] } })
        .sort({ votesFor: -1 })
        .toArray(),
    ]);

    // Characters store `party` as the country's party sequentialId (e.g. "2"),
    // not a slug. Resolve it to the party's abbreviation (CDU/SPD/…) so the
    // panel shows a country-appropriate label instead of a bare number.
    const resolvePartyLabel = (party: string | null | undefined): string | null => {
      if (!party) return null;
      const p = partyMap.get(party);
      return p?.abbreviation ?? p?.name ?? party;
    };

    const policy = POLICY_BY_ROLE.speaker_of_the_bundestag;
    const chamberCtx = buildChamberLeadershipContext({
      composition: bundestag.composition,
      majorityParty: bundestag.majorityParty,
      majorityBloc: bundestag.majorityBloc,
    });
    const canRunForBundestagspraesident =
      myParty != null && isPartyEligible(policy, myParty, chamberCtx);
    const eligibilityLabel = describeEligibility(policy, chamberCtx);

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
      canRunForBundestagspraesident,
      eligibilityLabel,
      viewer: {
        characterId: myCharacterId,
        party: myParty,
        isSittingMdB,
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
    if (countryId !== "DE" || !COUNTRY_CONFIGS.DE) {
      return NextResponse.json(
        { error: "Bundestagspräsident endpoint is DE-only" },
        { status: 400 }
      );
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, bundestagspraesidentActionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action, nominationId } = parsed.data;

    const db = await getDb();
    const partyMap = await getPartyMap(db, "DE");
    const bundestag = await getBundestagComposition(db, partyMap);

    const result = await handleBundestagspraesidentAction({
      db,
      partyMap,
      bundestag,
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
