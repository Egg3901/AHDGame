import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser()
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import { ObjectId } from "mongodb";
import type { Character, Election } from "@/lib/db/types";
import { findBlockingActiveCandidacy } from "@/lib/elections/activeCandidacy";
import { resolveElection, resolveElections } from "@/lib/elections/resolveElection";
import { conditionalJson } from "@/lib/api/conditionalJson";
import { withApiMetrics } from "@/lib/observability/apiMetrics";

// GET /api/elections — Unified election data endpoint. Single mode (?id=X) or list mode (?country=X).
// Auth: public (optional auth for user-specific fields)
// Errors: 400, 404
async function handleGet(request: Request) {
  try {
    const url = new URL(request.url);
    const { searchParams } = url;

    const idParam = searchParams.get("id");
    const countryParam = searchParams.get("country");
    const viewParam = searchParams.get("view");
    const cycleParam = searchParams.get("cycle");
    const statusParam = searchParams.get("status");
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    const myElectionParam = searchParams.get("myElection");
    const stateParam = searchParams.get("state");
    const typeParam = searchParams.get("type");

    // Validate: at least one of id or country must be provided (unless myElection fast-path)
    const myElectionOnly = myElectionParam === "1";
    if (!idParam && !countryParam && !myElectionOnly) {
      return NextResponse.json(
        { error: "Either id or country query parameter is required" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // ── myElection fast-path ──────────────────────────────────────────────────
    // Lightweight query for the navbar: returns the current user's active election label.
    if (myElectionOnly) {
      const authUser = await getAuthUser();
      if (!authUser) return NextResponse.json({ myElection: null });

      const character = await db.collection<Character>("characters").findOne({
        userId: new ObjectId(authUser.userId),
      });
      if (!character) return NextResponse.json({ myElection: null });

      const blocking = await findBlockingActiveCandidacy(db, character._id);
      if (!blocking) return NextResponse.json({ myElection: null });
      const election = blocking.election;

      const typeLabel = formatElectionTypeLabel(
        election.electionType,
        (election.countryId ?? "US") as CountryId
      );

      const isNational = ["president", "primeMinister", "uachtaran"].includes(
        election.electionType
      );
      return NextResponse.json({
        myElection: {
          id: election._id.toString(),
          seatId: election.seatId ?? undefined,
          label: isNational ? `${typeLabel} — National` : `${typeLabel} — ${election.state}`,
        },
      });
    }

    // ── Optional auth (for user-specific fields in both modes) ───────────────
    const user = await getAuthUser();
    const userId = user?.userId ?? null;
    const isAdmin = user?.isAdmin ?? false;
    const activeCharacterId = user?.activeCharacterId ?? null;

    // ── Single mode (?id=X) ───────────────────────────────────────────────────
    if (idParam) {
      const view = (viewParam === "summary" ? "summary" : "full") as "full" | "summary";

      let cycle: number | undefined;
      if (cycleParam) {
        const parsed = parseInt(cycleParam, 10);
        if (isNaN(parsed)) {
          return NextResponse.json({ error: "Invalid cycle parameter" }, { status: 400 });
        }
        cycle = parsed;
      }

      const result = await resolveElection(
        db,
        idParam,
        { view, userId, isAdmin, activeCharacterId },
        cycle
      );
      if (!result) {
        return NextResponse.json({ error: "Election not found" }, { status: 404 });
      }

      // Polled every 60s on the election detail page. Per-user (resolveElection
      // applies fog-of-war by userId/character), so it must not be shared-cached;
      // ETag/304 keeps standings live while skipping the ~8KB body when unchanged.
      return conditionalJson(request, { election: result });
    }

    // ── List mode (?country=X) ────────────────────────────────────────────────
    const countryId = countryParam!.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const view = (viewParam === "full" ? "full" : "summary") as "full" | "summary";

    // Parse status filter (comma-separated, default "upcoming,active")
    const statusArray = statusParam
      ? statusParam.split(",").map((s) => s.trim())
      : ["upcoming", "active"];

    // Parse pagination
    const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(limitParam ?? "50", 10) || 50), 500);
    const skip = (page - 1) * limit;

    // Build country-aware query
    const query: Record<string, unknown> = {
      status: { $in: statusArray },
    };
    // Filter by country: match explicit countryId or legacy docs without countryId for US
    if (countryId === COUNTRY_CONFIGS.US.id) {
      query.$or = [{ countryId: COUNTRY_CONFIGS.US.id }, { countryId: { $exists: false } }];
    } else {
      query.countryId = countryId;
    }
    if (stateParam) query.state = stateParam;
    if (typeParam) query.electionType = typeParam;

    const collection = db.collection<Election>("elections");

    const [total, elections] = await Promise.all([
      collection.countDocuments(query),
      collection
        .find(query)
        .sort({ state: 1, electionType: 1, senateClass: 1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    const resolved = await resolveElections(db, elections, {
      view,
      userId,
      isAdmin,
      activeCharacterId,
    });

    return NextResponse.json({ elections: resolved, total, page });
  } catch (error) {
    return handleRouteError(error);
  }
}

// RED metrics: duration span + api.route tag + SLO availability signal, and any
// non-2xx is captured to GlitchTip grouped by (route, status). See
// src/lib/observability/apiMetrics.ts.
export const GET = withApiMetrics("elections.GET", handleGet);
