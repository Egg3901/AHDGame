/**
 * GET    /api/admin/country/[code]/elections — list elections (filtered by country from path)
 * POST   /api/admin/country/[code]/elections — create elections for a cycle
 * PATCH  /api/admin/country/[code]/elections — modify election timers
 * DELETE /api/admin/country/[code]/elections — delete all elections for a cycle
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminElectionsCreateSchema, adminElectionsPatchSchema } from "@/lib/api/schemas/admin";
import type { Election, SenateClass, State, GameState } from "@/lib/db/types";
import { SENATE_CLASSES, STATE_SENATE_SEATS } from "@/lib/constants";
import { isUsElectoralState } from "@/lib/constants/states";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { DEFAULT_DURATIONS } from "@/lib/turn/perpetualElections";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { cycleAnchorContextFromGameState } from "@/lib/elections/cycleAnchorContext";
import { electionToLarpYear } from "@/lib/utils/formatters";

// GET - List all elections
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const cycle = searchParams.get("cycle");
    const status = searchParams.get("status");
    const electionType = searchParams.get("type");
    const state = searchParams.get("state");

    const db = await getDb();

    // Build query — always filter by countryId from path
    const query: Record<string, unknown> = { countryId };
    if (cycle) query.cycle = parseInt(cycle, 10);
    if (status) query.status = status;
    if (electionType) query.electionType = electionType;
    if (state) query.state = state;

    const [elections, gameState] = await Promise.all([
      db
        .collection<Election>("elections")
        .find(query)
        .sort({ state: 1, electionType: 1, senateClass: 1, chamberClass: 1 })
        .toArray(),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
    ]);

    // Get candidate counts for each election
    const electionIds = elections.map((e) => e._id);
    const candidateCounts = await db
      .collection("electionCandidates")
      .aggregate([
        { $match: { electionId: { $in: electionIds }, status: "active" } },
        { $group: { _id: "$electionId", count: { $sum: 1 } } },
      ])
      .toArray();

    const countMap = new Map(candidateCounts.map((c) => [c._id.toString(), c.count]));

    const electionsWithCounts = elections.map((e) => ({
      ...e,
      _id: e._id.toString(),
      candidateCount: countMap.get(e._id.toString()) || 0,
    }));

    return NextResponse.json({
      elections: electionsWithCounts,
      total: elections.length,
      currentTurn: gameState?.currentTurn ?? null,
      lastTurnProcessed: gameState?.lastTurnProcessed ?? null,
      startingYear: gameState?.startingYear ?? null,
      preset: gameState?.preset ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST - Create elections for a cycle
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    // Consume path param (POST creates US elections per original logic)
    await params;

    const parsed = await parseJsonBody(request, adminElectionsCreateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { cycle, senateClass, includeHouse, includeStateSenate, includeGovernor } = parsed.data;

    const db = await getDb();
    const now = new Date();

    // Get all US electoral states. Federal districts like DC live in `states`
    // for economy/presidential electoral votes but elect no House/Senate/
    // Governor/state-legislature seats, so exclude them.
    const states = (await db.collection<State>("states").find({}).toArray()).filter((s) =>
      isUsElectoralState(s._id)
    );

    if (states.length === 0) {
      return NextResponse.json(
        { error: "No states found. Please seed states first." },
        { status: 400 }
      );
    }

    // Check if elections for this cycle already exist
    const existingCount = await db.collection("elections").countDocuments({ cycle });
    if (existingCount > 0) {
      return NextResponse.json(
        { error: `Elections for cycle ${cycle} already exist. Delete them first to recreate.` },
        { status: 409 }
      );
    }

    // Read the active preset so each spawned doc's electionYear anchors to
    // the right calendar regardless of preset (1991-default vs 2019-default).
    const gameStateForCtx = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const ctx = cycleAnchorContextFromGameState(gameStateForCtx);

    const electionsToInsert: Omit<Election, "_id">[] = [];

    for (const state of states) {
      const stateId = state._id;
      const stateClasses = SENATE_CLASSES[stateId] || [1, 2];

      // Create Senate elections for states with the specified class
      if (senateClass && stateClasses.includes(senateClass as SenateClass)) {
        electionsToInsert.push({
          electionType: "senate",
          state: stateId,
          countryId: "US",
          senateClass: senateClass as SenateClass,
          cycle,
          electionYear: electionToLarpYear(
            "senate",
            cycle,
            senateClass as SenateClass,
            undefined,
            ctx
          ),
          status: "upcoming",
          createdAt: now,
          updatedAt: now,
        });
      }

      // Create House election for this state if requested
      if (includeHouse) {
        electionsToInsert.push({
          electionType: "house",
          state: stateId,
          countryId: "US",
          cycle,
          electionYear: electionToLarpYear("house", cycle, undefined, undefined, ctx),
          status: "upcoming",
          // Seeded `houseDistricts` is the preset-correct apportionment SSOT
          // (1990 census for 1991 games, 2020 census otherwise).
          totalSeats: state.houseDistricts || 1,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Create State Senate election for this state if requested
      if (includeStateSenate) {
        electionsToInsert.push({
          electionType: "stateSenate",
          state: stateId,
          countryId: "US",
          cycle,
          electionYear: electionToLarpYear("stateSenate", cycle, undefined, undefined, ctx),
          status: "upcoming",
          totalSeats: STATE_SENATE_SEATS[stateId] || 30,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Create Governor election for this state if requested
      if (includeGovernor) {
        electionsToInsert.push({
          electionType: "governor",
          state: stateId,
          countryId: "US",
          cycle,
          electionYear: electionToLarpYear("governor", cycle, undefined, undefined, ctx),
          status: "upcoming",
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const result = await db.collection("elections").insertMany(electionsToInsert);

    const senateCount = electionsToInsert.filter((e) => e.electionType === "senate").length;
    const houseCount = electionsToInsert.filter((e) => e.electionType === "house").length;
    const stateSenateCount = electionsToInsert.filter(
      (e) => e.electionType === "stateSenate"
    ).length;
    const governorCount = electionsToInsert.filter((e) => e.electionType === "governor").length;

    return NextResponse.json({
      success: true,
      message: `Created ${result.insertedCount} elections for cycle ${cycle}`,
      counts: {
        total: result.insertedCount,
        senate: senateCount,
        house: houseCount,
        stateSenate: stateSenateCount,
        governor: governorCount,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH - Modify election timers
export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, adminElectionsPatchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const {
      electionType,
      state,
      senateClass,
      chamberClass,
      cycle,
      action,
      primaryHours,
      generalHours,
    } = parsed.data;

    const db = await getDb();

    // Build query — always scoped by countryId from path
    const query: Record<string, unknown> = { countryId };
    if (electionType) query.electionType = electionType;
    if (state) query.state = state;
    if (senateClass) query.senateClass = senateClass;
    if (chamberClass) query.chamberClass = chamberClass;
    if (cycle) query.cycle = cycle;

    const elections = await db.collection<Election>("elections").find(query).toArray();

    if (elections.length === 0) {
      return NextResponse.json({ error: "No elections found matching criteria" }, { status: 404 });
    }

    // Use game time (lastTurnProcessed) instead of real wall-clock time
    // so election timers advance with turn processing
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const now = gameState?.lastTurnProcessed ? new Date(gameState.lastTurnProcessed) : new Date();
    // `now` == lastTurnProcessed, which corresponds to currentTurn — used to
    // stamp the turn-first deadline fields alongside the recalculated Dates.
    const currentTurn = gameState?.currentTurn ?? 1;
    let updatedCount = 0;

    for (const election of elections) {
      const updates: Record<string, unknown> = { updatedAt: now };

      // Current DB values: durationHours = total, primaryDurationHours = general phase length (offset from end)
      const defaults = DEFAULT_DURATIONS[election.electionType] ?? DEFAULT_DURATIONS.house;
      const currentTotal = election.durationHours ?? defaults.durationHours;
      const currentGeneral = election.primaryDurationHours ?? defaults.primaryDurationHours;
      const currentPrimary = currentTotal - currentGeneral;

      // Apply action using the new primaryHours/generalHours inputs
      let newPrimary = currentPrimary;
      let newGeneral = currentGeneral;

      if (action === "set") {
        if (primaryHours !== undefined) newPrimary = primaryHours;
        if (generalHours !== undefined) newGeneral = generalHours;
      } else if (action === "add") {
        if (primaryHours !== undefined) newPrimary += primaryHours;
        if (generalHours !== undefined) newGeneral += generalHours;
      } else if (action === "subtract") {
        if (primaryHours !== undefined) newPrimary = Math.max(0, newPrimary - primaryHours);
        if (generalHours !== undefined) newGeneral = Math.max(0, newGeneral - generalHours);
      }

      // Ensure at least 1 hour total
      const newTotal = Math.max(1, newPrimary + newGeneral);
      // DB field: primaryDurationHours = general phase length (offset from end)
      const newPrimaryDurationHours = newGeneral;

      updates.durationHours = newTotal;
      updates.primaryDurationHours = newPrimaryDurationHours;

      // Recalculate times
      // When action="set", reset startTime to now so election activates immediately
      // For "add"/"subtract", preserve existing startTime
      const startTime = action === "set" ? now : election.startTime || now;
      const newEndTime = new Date(startTime.getTime() + newTotal * 60 * 60 * 1000);
      const newPrimaryEndTime = new Date(
        newEndTime.getTime() - newPrimaryDurationHours * 60 * 60 * 1000
      );

      updates.startTime = startTime;
      updates.endTime = newEndTime;
      updates.primaryEndTime = newPrimaryEndTime;

      // Turn-first deadline fields mirror the Dates above (1 turn = 1 hour).
      // "set" anchors the start to the current turn; "add"/"subtract" keep the
      // existing start turn (derived from the preserved startTime when absent).
      const startTurnVal =
        action === "set"
          ? currentTurn
          : (election.startTurn ??
            currentTurn - Math.round((now.getTime() - startTime.getTime()) / MS_PER_TURN));
      const newEndTurn = startTurnVal + newTotal;
      updates.startTurn = startTurnVal;
      updates.endTurn = newEndTurn;
      updates.primaryEndTurn = newEndTurn - newPrimaryDurationHours;

      // Keep status consistent with the start turn so the UI doesn't render the
      // "upcoming + start in the past" intermediate state until the next
      // advanceElectionTimers tick.
      if (election.status === "upcoming" && startTurnVal <= currentTurn) {
        updates.status = "active";
      }

      await db.collection("elections").updateOne({ _id: election._id }, { $set: updates });
      updatedCount++;
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${updatedCount} election(s)`,
      updatedCount,
      filters: { electionType, state, countryId, senateClass, chamberClass, cycle },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE - Delete all elections for a cycle
export async function DELETE(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    // Consume path param
    await params;

    const { searchParams } = new URL(request.url);
    const cycle = searchParams.get("cycle");

    if (!cycle) {
      return NextResponse.json({ error: "Cycle parameter is required" }, { status: 400 });
    }

    const db = await getDb();
    const cycleNum = parseInt(cycle, 10);

    // Get election IDs for this cycle
    const elections = await db
      .collection<Election>("elections")
      .find({ cycle: cycleNum })
      .toArray();

    const electionIds = elections.map((e) => e._id);

    // Delete all election-linked data for this cycle
    const [candidatesResult, talliesResult, campaignsResult] = await Promise.all([
      db.collection("electionCandidates").deleteMany({ electionId: { $in: electionIds } }),
      db.collection("electionVoteTallies").deleteMany({ electionId: { $in: electionIds } }),
      db.collection("campaigns").deleteMany({ electionId: { $in: electionIds } }),
    ]);

    // Delete all elections for this cycle
    const electionsResult = await db.collection("elections").deleteMany({ cycle: cycleNum });

    return NextResponse.json({
      success: true,
      message: `Deleted ${electionsResult.deletedCount} elections, ${candidatesResult.deletedCount} candidates, ${talliesResult.deletedCount} tallies, ${campaignsResult.deletedCount} campaigns for cycle ${cycle}`,
      deletedElections: electionsResult.deletedCount,
      deletedCandidates: candidatesResult.deletedCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
