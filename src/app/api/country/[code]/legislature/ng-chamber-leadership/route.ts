/**
 * GET  /api/country/ng/legislature/ng-chamber-leadership
 *   Returns, for both NG presiding-officer roles (Speaker of the House of
 *   Representatives, President of the Senate): the current holder, the active
 *   election (24h window), open nominations, viewer eligibility, and viewer
 *   identity. Auto-resolves an expired-but-not-yet-resolved election before
 *   responding (parity with the DE Bundestagspräsident GET).
 *
 * POST /api/country/ng/legislature/ng-chamber-leadership
 *   Body: { role, action, nominationId? }. Actions: declare | withdraw | vote
 *   | start_election (admin) | force_end (admin).
 *
 * Mirror of `/api/country/de/legislature/bundestagspraesident` for the NG
 * National Assembly. Same 24h window, same plurality-winner rule, same
 * any-seated eligibility. Two roles served by one route; NPPs do not vote.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getPartyMap } from "@/lib/db/partyMap";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getAuthUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { resolveExecutiveHolder } from "@/lib/elections/resolveExecutiveHolder";
import {
  buildChamberLeadershipContext,
  describeEligibility,
  isPartyEligible,
  POLICY_BY_ROLE,
} from "@/lib/congress/leadership/rolePolicy";
import { ObjectId } from "mongodb";
import type {
  NgChamberLeadershipElection,
  NgChamberLeadershipNomination,
  NgChamberLeadershipRole,
  Character,
  ElectedOfficial,
} from "@/lib/db/types";
import {
  NG_ROLES,
  NG_ROLE_CONFIG,
  NG_ELECTION_COLLECTION,
  NG_NOMINATION_COLLECTION,
} from "@/lib/congress/ngChamberLeadership/config";
import { getNgChamberComposition } from "@/lib/congress/ngChamberLeadership/composition";
import { resolveNgChamberLeadershipElection } from "@/lib/congress/ngChamberLeadership/resolveElection";
import { handleNgChamberLeadershipAction } from "@/lib/congress/ngChamberLeadership/actions";

const actionSchema = z.object({
  role: z.enum(["speaker_ng_reps", "president_ng_senate"]),
  action: z.enum(["declare", "withdraw", "vote", "start_election", "force_end"]),
  nominationId: z.string().optional(),
});

function isNgRequest(code: string): boolean {
  return code.toUpperCase() === "NG";
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    if (!isNgRequest(code)) {
      return NextResponse.json({ error: "This endpoint is NG-only" }, { status: 400 });
    }
    const db = await getDb();
    const partyMap = await getPartyMap(db, "NG");
    const authUser = await getAuthUser().catch(() => null);

    // Resolve the viewer's character once; used for viewer identity, chamber
    // membership per role, and reading back myVote.
    let myCharacterId: string | null = null;
    let myParty: string | null = null;
    let myCharObjId: ObjectId | null = null;
    if (authUser) {
      const char = await db
        .collection<Character>("characters")
        .findOne({ userId: new ObjectId(authUser.userId) });
      if (char) {
        myCharacterId = char._id.toString();
        myParty = char.party ?? null;
        myCharObjId = char._id;
      }
    }

    const resolvePartyLabel = (party: string | null | undefined): string | null => {
      if (!party) return null;
      const p = partyMap.get(party);
      return p?.abbreviation ?? p?.name ?? party;
    };

    const gameTime = await getGameTime();

    const roles = await Promise.all(
      NG_ROLES.map(async (role) => {
        const cfg = NG_ROLE_CONFIG[role];

        // Auto-resolve an expired election before responding.
        const electionDoc = await db
          .collection<NgChamberLeadershipElection>(NG_ELECTION_COLLECTION)
          .findOne({ _id: role });
        if (
          electionDoc?.status === "voting" &&
          isLeadershipElectionClosed(electionDoc, gameTime.currentTurn, gameTime.effectiveNow)
        ) {
          await resolveNgChamberLeadershipElection(db, role);
        }

        const [officerOfficial, election, nominations] = await Promise.all([
          db
            .collection<ElectedOfficial>("electedOfficials")
            .findOne({ officeType: cfg.officerOfficeType, countryId: "NG" }),
          db.collection<NgChamberLeadershipElection>(NG_ELECTION_COLLECTION).findOne({ _id: role }),
          db
            .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
            .find({ role, status: { $in: ["open", "voting"] } })
            .sort({ votesFor: -1 })
            .toArray(),
        ]);

        const leader = await resolveExecutiveHolder(db, officerOfficial);

        const isMember = myCharObjId
          ? !!(await db.collection<ElectedOfficial>("electedOfficials").findOne({
              characterId: myCharObjId,
              officeType: cfg.memberOfficeType,
              countryId: "NG",
            }))
          : false;

        const composition = await getNgChamberComposition(db, partyMap, cfg.memberOfficeType);
        const policy = POLICY_BY_ROLE[role];
        const chamberCtx = buildChamberLeadershipContext({
          composition: composition.composition,
          majorityParty: composition.majorityParty,
          majorityBloc: composition.majorityBloc,
        });
        const canRun = myParty != null && isPartyEligible(policy, myParty, chamberCtx);
        const eligibilityLabel = describeEligibility(policy, chamberCtx);

        return {
          role,
          label: cfg.label,
          leader: leader
            ? {
                characterId: leader.characterId || null,
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
          isMember,
        };
      })
    );

    return NextResponse.json({
      roles,
      viewer: {
        characterId: myCharacterId,
        party: myParty,
        isAdmin: authUser?.isAdmin ?? false,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    if (!isNgRequest(code)) {
      return NextResponse.json({ error: "This endpoint is NG-only" }, { status: 400 });
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { role, action, nominationId } = parsed.data;

    const db = await getDb();
    const partyMap = await getPartyMap(db, "NG");

    const result = await handleNgChamberLeadershipAction({
      db,
      partyMap,
      role: role as NgChamberLeadershipRole,
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
