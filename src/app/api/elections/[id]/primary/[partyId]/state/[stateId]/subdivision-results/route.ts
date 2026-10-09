import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { loadPrimaryPartyData } from "@/lib/elections/primaryPartyDetail";
import { loadSubdivisionFile } from "@/lib/maps/subdivisionData";
import { distributePrimaryCounties } from "@/lib/elections/primaryRegional/rules";

interface RouteParams {
  params: Promise<{ id: string; partyId: string; stateId: string }>;
}

const partyIdSchema = z.string().min(1).max(32);
const stateIdSchema = z.string().regex(/^[A-Za-z]{2}$/);

// GET /api/elections/[id]/primary/[partyId]/state/[stateId]/subdivision-results
// One party's presidential primary in one state, by county: the state's
// primary votes (counted where the state has voted, projected otherwise),
// spread across its counties by each candidate's ideology relative to the
// field. Same response shape as the general-election county route so the map
// can draw either.
// Auth: requireBasicAuth (the per-party primary detail it reads is auth-only)
// Errors: 400, 401, 404, 429
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`primary-counties:${auth.user.userId}`, 120, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, partyId, stateId } = await params;
    const party = partyIdSchema.safeParse(partyId);
    const state = stateIdSchema.safeParse(stateId);
    if (!party.success) return errorResponse(400, "Invalid party id");
    if (!state.success) return errorResponse(400, "Invalid state id");
    const regionId = state.data.toUpperCase();

    const db = await getDb();
    const resolved = await resolveElectionRouteParam(db, id);
    if (!resolved.ok) {
      const invalid = resolved.reason === "invalid_id";
      return errorResponse(
        invalid ? 400 : 404,
        invalid ? "Invalid election id" : "Election not found"
      );
    }
    const election = resolved.election;
    if (election.electionType !== "president" || (election.countryId ?? "US") !== "US") {
      return errorResponse(404, "County results are only available for US presidential primaries");
    }

    const data = await loadPrimaryPartyData(db, {
      election,
      partyId: party.data,
      viewer: {
        userId: auth.user.userId,
        activeCharacterId: auth.user.activeCharacterId ?? null,
      },
    });
    if (!data) return errorResponse(404, "Party not in this race");

    const stateVotes = data.detail.byState[regionId] ?? {};
    if (Object.values(stateVotes).every((v) => !(v > 0))) {
      return errorResponse(404, "No primary result for this state yet");
    }

    const file = await loadSubdivisionFile("counties", regionId);
    if (!file) return errorResponse(404, "County data not available for this state");

    // Each candidate's economic position: the character's, or the NPP's.
    const econByCandidate: Record<string, number> = {};
    for (const c of data.candidates) {
      const key = c._id.toString();
      const econ =
        c.isNPP && c.nppId
          ? data.nppMap.get(c.nppId.toString())?.policies?.economic
          : data.charMap.get(c.characterId?.toString() ?? "")?.policies?.economic;
      if (typeof econ === "number") econByCandidate[key] = econ;
    }

    const rows = distributePrimaryCounties(
      file.subdivisions.map((s) => ({
        id: s.id,
        name: s.name,
        electorate: Number(s.electorate) || 0,
        lean: s.leanScalar == null ? undefined : Number(s.leanScalar),
      })),
      stateVotes,
      econByCandidate,
      String(election._id),
      regionId
    );
    const pathById = new Map(file.subdivisions.map((s) => [s.id, s.path]));

    const candidateNames: Record<string, string> = {};
    const candidateColors: Record<string, string> = {};
    for (const c of data.detail.candidates) {
      candidateNames[c.id] = c.name;
      candidateColors[c.id] = c.color;
    }

    return NextResponse.json({
      viewBox: file.viewBox,
      mode: "distributed",
      subdivisions: rows.map((r) => {
        const ranked = Object.entries(r.votes).sort((a, b) => b[1] - a[1]);
        const total = ranked.reduce((s, [, v]) => s + v, 0);
        const margin =
          total > 0 && ranked.length > 1 ? ((ranked[0][1] - ranked[1][1]) / total) * 100 : 100;
        return {
          id: r.id,
          name: r.name,
          path: pathById.get(r.id) ?? "",
          votes: r.votes,
          winner: ranked[0]?.[0] ?? "",
          margin,
        };
      }),
      candidateNames,
      candidateColors,
      voted: data.detail.votedStateIds.includes(regionId),
    });
  } catch (error) {
    return handleRouteError(error, {
      request,
      route: "/api/elections/[id]/primary/[partyId]/state/[stateId]/subdivision-results",
    });
  }
}
