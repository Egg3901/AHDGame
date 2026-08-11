import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { setPriorityRegionSchema } from "@/lib/api/schemas/parties";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { canActAsChair } from "@/lib/parties/actingChair";
import { getGameTime } from "@/lib/time/gameTime";
import {
  isPriorityRegionLocked,
  partyHoldsStateExecutiveInCluster,
  priorityRegionUnlockTurn,
  validatePriorityRegionCluster,
} from "@/lib/parties/priorityRegion";
import type { ElectedOfficial, PoliticalParty, State } from "@/lib/db/types";
import { PRIORITY_REGION_LOCKOUT_TURNS } from "@/lib/turn/politicalStrength/strengthConstants";

/**
 * Returns the state IDs in this country where the given party holds the
 * state-level executive office (per the per-country office mapping in
 * `regionalExecutive.ts` — US/UK/JP use "governor", DE uses
 * "ministerPresident"). UK English non-London regions never qualify
 * because no governor row gets elected there in the first place.
 *
 * Used by the GET handler to surface a `(Gov)` indicator on states the
 * party already anchors, AND to feed the per-pick anchor check the
 * setter route does in-band.
 */
async function listPartyStateExecutives(
  db: import("mongodb").Db,
  countryId: CountryId,
  partySequentialId: number
): Promise<string[]> {
  const partyIdStr = String(partySequentialId);
  const rows = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      countryId,
      party: partyIdStr,
      officeType: { $in: ["governor", "ministerPresident"] },
    })
    .project<{ state: string }>({ state: 1 })
    .toArray();
  return Array.from(new Set(rows.map((r) => r.state)));
}

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

/**
 * GET — surface the party's current Priority Region cluster + computed
 * unlock turn so the Chair Office UI can render lockout countdown
 * without computing it client-side.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const { currentTurn } = await getGameTime();
    const cluster = party.priorityRegion ?? null;
    const unlockTurn = priorityRegionUnlockTurn(party);
    const governorStates = await listPartyStateExecutives(db, countryId, party.sequentialId);

    return NextResponse.json({
      priorityRegion: cluster
        ? {
            stateIds: cluster.stateIds,
            setAtTurn: cluster.setAtTurn,
            setBy: cluster.setBy.toString(),
          }
        : null,
      unlockTurn,
      turnsRemaining: unlockTurn != null ? Math.max(0, unlockTurn - currentTurn) : 0,
      isLocked: isPriorityRegionLocked(party, currentTurn),
      lockoutDurationTurns: PRIORITY_REGION_LOCKOUT_TURNS,
      governorStates,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST — set the Priority Region cluster.
 *
 * Auth: chair / vice-chair (when acting as chair) / admin.
 * Lockout: rejects (409) when the slot is still within the
 * `PRIORITY_REGION_LOCKOUT_TURNS` window from the prior set.
 * Validation: cluster size, connectedness, state existence in country.
 *
 * `hasGovernorAnchor` defaults to `false` for this initial route;
 * Phase F adds the per-country executive lookup that enables the +1
 * state allowance when the party holds a state-level executive in
 * one of the picked states.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    if (authResult.user.isBanned) {
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }
    const { user } = authResult;

    const rateLimit = checkRateLimit(user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, setPriorityRegionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { stateIds } = parsed.data;
    const upperStateIds = stateIds.map((id) => id.toUpperCase());

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    // Chair / VC-acting / admin only.
    const isAdmin = !!user.isAdmin;
    if (!isAdmin && !canActAsChair(party, user.character._id)) {
      return NextResponse.json(
        { error: "Only the chair or acting vice-chair can set the Priority Region." },
        { status: 403 }
      );
    }

    // Lockout check.
    const { currentTurn } = await getGameTime();
    if (isPriorityRegionLocked(party, currentTurn)) {
      const unlockAt = priorityRegionUnlockTurn(party);
      return NextResponse.json(
        {
          error: `Priority Region is locked until turn ${unlockAt}.`,
          unlockTurn: unlockAt,
          turnsRemaining: unlockAt != null ? unlockAt - currentTurn : 0,
        },
        { status: 409 }
      );
    }

    // Governor anchor check (Phase F): the party gets +1 cluster slot
    // when it holds the state-level executive in at least one of the
    // picked states. Per-country office mapping lives in
    // `getRegionalExecutive`; countries without a state-level executive
    // (IE, CN, English non-London UK regions) simply never qualify.
    const hasGovernorAnchor = await partyHoldsStateExecutiveInCluster(
      db,
      party,
      countryId,
      upperStateIds
    );

    const validation = validatePriorityRegionCluster(countryId, upperStateIds, hasGovernorAnchor);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    // State-existence check against the actual states collection — every
    // picked state must exist and belong to this country.
    const stateDocs = await db
      .collection<State>("states")
      .find({ _id: { $in: upperStateIds }, countryId })
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    const knownStateIds = new Set(stateDocs.map((s) => s._id));
    const unknown = upperStateIds.filter((id) => !knownStateIds.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unknown state(s) in ${countryId}: ${unknown.join(", ")}` },
        { status: 400 }
      );
    }

    // Atomic write — guards on the lockout one more time inside the
    // updateOne filter so two concurrent setters racing against an
    // expired lockout don't both win.
    const now = new Date();
    const result = await db.collection<PoliticalParty>("politicalParties").updateOne(
      {
        _id: party._id,
        // Guard: only set if currently unlocked. `priorityRegion` either
        // doesn't exist OR its unlockTurn (setAtTurn + LOCKOUT) ≤
        // currentTurn. Encoded as: priorityRegion missing OR setAtTurn
        // ≤ currentTurn - LOCKOUT.
        $or: [
          { priorityRegion: { $exists: false } },
          {
            "priorityRegion.setAtTurn": {
              $lte: currentTurn - PRIORITY_REGION_LOCKOUT_TURNS,
            },
          },
        ],
      },
      {
        $set: {
          priorityRegion: {
            stateIds: upperStateIds,
            setAtTurn: currentTurn,
            setBy: user.character._id,
          },
          updatedAt: now,
        },
      }
    );
    if (result.matchedCount === 0) {
      // Lost the race against another concurrent setter.
      return NextResponse.json(
        { error: "Priority Region was just set by another concurrent action." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      priorityRegion: {
        stateIds: upperStateIds,
        setAtTurn: currentTurn,
        setBy: user.character._id.toString(),
      },
      hasGovernorAnchor,
      unlockTurn: currentTurn + PRIORITY_REGION_LOCKOUT_TURNS,
      lockoutDurationTurns: PRIORITY_REGION_LOCKOUT_TURNS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
