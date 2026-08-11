import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { State, ElectedOfficial, SenateClass, Election, GameState } from "@/lib/db/types";
import { SENATE_CLASSES } from "@/lib/constants";
import { getHouseSeats, isUsElectoralState } from "@/lib/constants/states";
import { MS_PER_TURN, SENATE_STAGGER_TURNS } from "@/lib/constants/turnTime";
import { cycleAnchorContextFromGameState } from "@/lib/elections/cycleAnchorContext";
import { electionToLarpYear } from "@/lib/utils/formatters";

// POST /api/admin/officials/init — Initializes elected official positions and cycle-1 elections for senate, house, or executive offices.
// Auth: requireAdmin
// Errors: 400, 401, 403, 409
export async function POST(request: Request) {
  try {
    // Verify admin authentication
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const officeType = searchParams.get("type"); // "senate", "house", "executive", or null for all

    const db = await getDb();
    const now = new Date();

    // ── Executive (US President + VP) only ────────────────────────────────────
    // Scoped to countryId: "US". CN now also has a ceremonial President row
    // (auto-populated from CCP.chairId by partyChairHeadOfState); that's a separate
    // office tree and is initialised by the bootstrap + per-turn sync, not
    // by this admin init route.
    if (officeType === "executive") {
      const existingPres = await db
        .collection("electedOfficials")
        .countDocuments({ countryId: "US", officeType: "president" });
      const existingVP = await db
        .collection("electedOfficials")
        .countDocuments({ countryId: "US", officeType: "vicePresident" });
      if (existingPres > 0 && existingVP > 0) {
        return NextResponse.json(
          { error: "President and Vice President positions already exist", count: 2 },
          { status: 409 }
        );
      }
      const execToInsert: Omit<ElectedOfficial, "_id">[] = [];
      if (existingPres === 0) {
        execToInsert.push({
          countryId: "US",
          officeType: "president",
          isAppointment: false,
          characterId: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (existingVP === 0) {
        execToInsert.push({
          countryId: "US",
          officeType: "vicePresident",
          isAppointment: false,
          characterId: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (execToInsert.length > 0) {
        await db.collection("electedOfficials").insertMany(execToInsert);
      }
      return NextResponse.json({
        success: true,
        message: `Executive positions initialized (${execToInsert.length} created)`,
        counts: { president: existingPres === 0 ? 1 : 0, vicePresident: existingVP === 0 ? 1 : 0 },
      });
    }

    // ── Senate / House (require states) ────────────────────────────────────────
    // Active preset drives House apportionment (1950 vs 1990 vs 2020 census) and
    // the era statehood roster. Read BEFORE the state filter — the apportionment
    // map is what defines statehood — and reused below for cycle-1 anchoring.
    const presetGameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const presetHouseSeats = getHouseSeats(presetGameState?.preset);

    // Only full electoral states, and only those the ACTIVE preset apportions.
    // Federal districts like DC live in `states` for economy/presidential
    // electoral votes but elect none of these seats. `isUsElectoralState` is
    // preset-INDEPENDENT (the modern 50-state set), so it alone would fabricate
    // officials for pre-statehood territories (Alaska/Hawaii before 1959) that
    // `seedSeats` gives no seat — the same era gate `initializeOfficials` and
    // `seedSeats` apply. Keep all three in step.
    const states = (await db.collection<State>("states").find({}).toArray()).filter(
      (s) => isUsElectoralState(s._id) && presetHouseSeats[s._id] != null
    );

    if (states.length === 0) {
      return NextResponse.json(
        { error: "No states found. Please seed states first." },
        { status: 400 }
      );
    }

    // Check if officials of this type already exist
    const typeFilter = officeType ? { officeType } : {};
    const existingCount = await db.collection("electedOfficials").countDocuments(typeFilter);

    if (existingCount > 0) {
      const typeLabel = officeType ? `${officeType} positions` : "elected officials";
      return NextResponse.json(
        {
          error: `${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} already initialized`,
          count: existingCount,
          message: "Use the reset endpoint to reinitialize if needed.",
        },
        { status: 409 }
      );
    }

    // Same doc/apportionment map read above for the statehood gate — reused here
    // for per-state seat counts and the cycle-1 LARP-year anchoring below.
    const gameState = presetGameState;
    const houseSeatsByState = presetHouseSeats;

    const officialsToInsert: Omit<ElectedOfficial, "_id">[] = [];
    let senateCount = 0;
    let houseCount = 0;

    for (const state of states) {
      const stateId = state._id;

      // Create Senate seats if not filtering to house only
      if (!officeType || officeType === "senate") {
        const classes = (SENATE_CLASSES[stateId] || [1, 2]) as [SenateClass, SenateClass];

        officialsToInsert.push({
          officeType: "senate",
          state: stateId,
          isAppointment: false,
          senateClass: classes[0],
          characterId: null,
          createdAt: now,
          updatedAt: now,
        });

        officialsToInsert.push({
          officeType: "senate",
          state: stateId,
          isAppointment: false,
          senateClass: classes[1],
          characterId: null,
          createdAt: now,
          updatedAt: now,
        });
        senateCount += 2;
      }

      // Create House seats if not filtering to senate only
      if (!officeType || officeType === "house") {
        const seatCount = houseSeatsByState[stateId] || 1;
        for (let district = 1; district <= seatCount; district++) {
          officialsToInsert.push({
            officeType: "house",
            state: stateId,
            isAppointment: false,
            district,
            characterId: null,
            createdAt: now,
            updatedAt: now,
          });
          houseCount++;
        }
      }
    }

    // Insert all officials
    const result = await db.collection("electedOfficials").insertMany(officialsToInsert);

    // Also create elections for cycle 1
    const electionsToInsert: Omit<Election, "_id">[] = [];
    let senateElections = 0;
    let houseElections = 0;

    // 48 turns = 1 year. House 2y (96t), Senate 6y (288t), staggered by class.
    const { DEFAULT_DURATIONS } = await import("@/lib/turn/perpetualElections");
    const senateDur = DEFAULT_DURATIONS.senate;
    const houseDur = DEFAULT_DURATIONS.house;

    // Check if elections already exist for cycle 1
    const existingElectionsCount = await db.collection("elections").countDocuments({ cycle: 1 });

    if (existingElectionsCount === 0) {
      // Cycle-1 LARP years anchor to the active preset's calendar (1991-default
      // → 1992 House / per-class Senate; 2019-default → 2022 House, etc.).
      const ctx = cycleAnchorContextFromGameState(gameState);

      for (const state of states) {
        const stateId = state._id;

        // Create Senate elections if initializing senate (staggered by class: Class 1 now, Class 2 +96t, Class 3 +192t)
        if (!officeType || officeType === "senate") {
          const classes = (SENATE_CLASSES[stateId] || [1, 2]) as [SenateClass, SenateClass];

          for (const senateClass of classes) {
            const offsetTurns = SENATE_STAGGER_TURNS[senateClass] ?? 0;
            const startTime = new Date(now.getTime() + offsetTurns * MS_PER_TURN);
            const senatePrimaryEndTime = new Date(
              startTime.getTime() + senateDur.primaryDurationHours * MS_PER_TURN
            );
            const senateEndTime = new Date(
              startTime.getTime() + senateDur.durationHours * MS_PER_TURN
            );

            electionsToInsert.push({
              electionType: "senate",
              state: stateId,
              countryId: "US",
              senateClass: senateClass as SenateClass,
              cycle: 1,
              electionYear: electionToLarpYear("senate", 1, senateClass, undefined, ctx),
              status: offsetTurns === 0 ? "active" : "upcoming",
              startTime,
              endTime: senateEndTime,
              primaryEndTime: senatePrimaryEndTime,
              durationHours: senateDur.durationHours,
              primaryDurationHours: senateDur.primaryDurationHours,
              createdAt: now,
              updatedAt: now,
            });
            senateElections++;
          }
        }

        // Create House election if initializing house
        if (!officeType || officeType === "house") {
          const seatCount = houseSeatsByState[stateId] || 1;
          const housePrimaryEndTime = new Date(
            now.getTime() + houseDur.primaryDurationHours * MS_PER_TURN
          );
          const houseEndTime = new Date(now.getTime() + houseDur.durationHours * MS_PER_TURN);

          electionsToInsert.push({
            electionType: "house",
            state: stateId,
            countryId: "US",
            cycle: 1,
            electionYear: electionToLarpYear("house", 1, undefined, undefined, ctx),
            status: "active",
            totalSeats: seatCount,
            startTime: now,
            endTime: houseEndTime,
            primaryEndTime: housePrimaryEndTime,
            durationHours: houseDur.durationHours,
            primaryDurationHours: houseDur.primaryDurationHours,
            createdAt: now,
            updatedAt: now,
          });
          houseElections++;
        }
      }

      if (electionsToInsert.length > 0) {
        await db.collection("elections").insertMany(electionsToInsert);
      }
    }

    let message = "";
    if (officeType === "senate") {
      message = `Senate positions initialized (${senateCount} seats, ${senateElections} elections)`;
    } else if (officeType === "house") {
      message = `House positions initialized (${houseCount} seats, ${houseElections} elections)`;
    } else {
      message = `All positions initialized (${senateCount} Senate, ${houseCount} House, ${senateElections + houseElections} elections)`;
    }

    return NextResponse.json({
      success: true,
      message,
      counts: {
        total: result.insertedCount,
        senate: senateCount,
        house: houseCount,
        elections: senateElections + houseElections,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/admin/officials/init — Removes all vacant House seat records left over from the old system.
// Auth: requireAdmin
// Errors: 401, 403
export async function DELETE() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Delete all vacant House seats (not needed in new system)
    const result = await db.collection("electedOfficials").deleteMany({
      officeType: "house",
      characterId: null,
    });

    return NextResponse.json({
      success: true,
      message: `Cleaned up ${result.deletedCount} vacant House seat records`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/admin/officials/init — Returns counts of elected officials by office type, showing filled and vacant seats.
// Auth: public
// Errors: none
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const counts = await db
      .collection("electedOfficials")
      .aggregate([
        {
          $group: {
            _id: "$officeType",
            total: { $sum: 1 },
            filled: {
              $sum: { $cond: [{ $ne: ["$characterId", null] }, 1, 0] },
            },
          },
        },
      ])
      .toArray();

    const result: Record<string, { total: number; filled: number; vacant: number }> = {};
    let grandTotal = 0;
    let grandFilled = 0;

    for (const count of counts) {
      result[count._id] = {
        total: count.total,
        filled: count.filled,
        vacant: count.total - count.filled,
      };
      grandTotal += count.total;
      grandFilled += count.filled;
    }

    return NextResponse.json({
      initialized: grandTotal > 0,
      summary: {
        total: grandTotal,
        filled: grandFilled,
        vacant: grandTotal - grandFilled,
      },
      byOfficeType: result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
