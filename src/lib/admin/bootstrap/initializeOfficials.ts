/**
 * Initialize vacant-world elected officials and cycle-1 elections.
 * Creates president, VP, Senate (2 per state), and House seats,
 * plus cycle-1 elections. All operations are idempotent — skips if
 * officials already exist.
 */
import type { Db } from "mongodb";
import type { State, ElectedOfficial, SenateClass, Election, GameState } from "@/lib/db/types";
import { SENATE_CLASSES } from "@/lib/constants";
import { getHouseSeats, isUsElectoralState } from "@/lib/constants/states";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { MS_PER_TURN, SENATE_STAGGER_TURNS } from "@/lib/constants/turnTime";
import { cycleAnchorContextFromGameState } from "@/lib/elections/cycleAnchorContext";
import { admittedStateIdsAsOf } from "@/lib/elections/statehoodAdmission";
import { electionToLarpYear } from "@/lib/utils/formatters";

export async function initializeOfficials(db: Db): Promise<{
  message: string;
  counts: { senate: number; house: number; executive: number; elections: number };
}> {
  const now = new Date();

  const existingCount = await db.collection("electedOfficials").countDocuments();
  if (existingCount > 0) {
    return {
      message: `Officials already initialized (${existingCount} records)`,
      counts: { senate: 0, house: 0, executive: 0, elections: 0 },
    };
  }

  // Active preset drives House apportionment (1950 vs 1990 vs 2020 census), the
  // era statehood roster, and the cycle-1 LARP-year anchoring below. Must be read
  // BEFORE the state filter — the apportionment map is what defines statehood.
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const houseSeatsByState = getHouseSeats(gameState?.preset);

  // Only full electoral states get Senate/House officials + cycle-1 elections.
  //
  // Two exclusions, both required:
  //  1. `isUsElectoralState` — federal districts like DC live in `states` for
  //     economy/presidential electoral votes but elect none of these seats.
  //  2. Absence from the ACTIVE preset's apportionment map — a pre-statehood
  //     territory in this era (Alaska/Hawaii under 1953-default, which uses the
  //     1950 census; they were territories until 1959). `isUsElectoralState` is
  //     preset-INDEPENDENT (it is the modern 50-state set), so on its own it
  //     fabricates officials and cycle-1 elections for regions that `seedSeats`
  //     correctly refuses to give a seat — 6 phantom officials and 10 orphan
  //     election docs with no matching `seats` row, regenerated on every reset.
  //     This is the same era gate `seedSeats.ts` applies; keep the two in step.
  //     A territory admitted mid-game carries `admittedYear` and stays a state
  //     through a reset, so it is admitted to this roster too — otherwise a
  //     reset would hand it seats (seedSeats keeps them) but no officials.
  const allUsStates = await db.collection<State>("states").find({ countryId: "US" }).toArray();
  const admittedIds = new Set(
    admittedStateIdsAsOf(allUsStates, gameState?.currentYear ?? Number.POSITIVE_INFINITY)
  );
  const states = allUsStates.filter(
    (s) => isUsElectoralState(s._id) && (houseSeatsByState[s._id] != null || admittedIds.has(s._id))
  );

  if (states.length === 0) {
    return {
      message: "No US states found — skipping officials initialization",
      counts: { senate: 0, house: 0, executive: 0, elections: 0 },
    };
  }

  const officialsToInsert: Omit<ElectedOfficial, "_id">[] = [];
  let senateCount = 0;
  let houseCount = 0;

  // Executive: President + VP
  officialsToInsert.push(
    {
      officeType: "president",
      countryId: COUNTRY_CONFIGS.US.id,
      isAppointment: false,
      characterId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      officeType: "vicePresident",
      countryId: COUNTRY_CONFIGS.US.id,
      isAppointment: false,
      characterId: null,
      createdAt: now,
      updatedAt: now,
    }
  );

  for (const state of states) {
    const stateId = state._id;

    // Senate: 2 seats per state
    const classes = (SENATE_CLASSES[stateId] || [1, 2]) as [SenateClass, SenateClass];
    for (const cls of classes) {
      officialsToInsert.push({
        officeType: "senate",
        state: stateId,
        isAppointment: false,
        senateClass: cls,
        characterId: null,
        createdAt: now,
        updatedAt: now,
      });
      senateCount++;
    }

    // House seats
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

  await db.collection("electedOfficials").insertMany(officialsToInsert);

  // Create cycle-1 elections
  const existingElections = await db.collection("elections").countDocuments({ cycle: 1 });
  let electionsCreated = 0;

  if (existingElections === 0) {
    const { DEFAULT_DURATIONS } = await import("@/lib/turn/perpetualElections");
    const senateDur = DEFAULT_DURATIONS.senate;
    const houseDur = DEFAULT_DURATIONS.house;

    // Cycle-1 LARP years anchor to the active preset's calendar (1991-default
    // → 1992 House, per-class Senate; 2019-default → 2022 House, etc.).
    const ctx = cycleAnchorContextFromGameState(gameState);

    const electionsToInsert: Omit<Election, "_id">[] = [];

    for (const state of states) {
      const stateId = state._id;
      const classes = (SENATE_CLASSES[stateId] || [1, 2]) as [SenateClass, SenateClass];

      // Senate elections (staggered by class)
      for (const senateClass of classes) {
        const offsetTurns = SENATE_STAGGER_TURNS[senateClass] ?? 0;
        const startTime = new Date(now.getTime() + offsetTurns * MS_PER_TURN);
        const primaryEndTime = new Date(
          startTime.getTime() + senateDur.primaryDurationHours * MS_PER_TURN
        );
        const endTime = new Date(startTime.getTime() + senateDur.durationHours * MS_PER_TURN);

        electionsToInsert.push({
          electionType: "senate",
          state: stateId,
          countryId: "US",
          senateClass: senateClass as SenateClass,
          cycle: 1,
          electionYear: electionToLarpYear("senate", 1, senateClass, undefined, ctx),
          status: offsetTurns === 0 ? "active" : "upcoming",
          startTime,
          endTime,
          primaryEndTime,
          durationHours: senateDur.durationHours,
          primaryDurationHours: senateDur.primaryDurationHours,
          createdAt: now,
          updatedAt: now,
        });
      }

      // House election
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
    }

    if (electionsToInsert.length > 0) {
      await db.collection("elections").insertMany(electionsToInsert);
      electionsCreated = electionsToInsert.length;
    }
  }

  return {
    message: `Initialized ${senateCount} Senate + ${houseCount} House + 2 executive officials, ${electionsCreated} elections`,
    counts: { senate: senateCount, house: houseCount, executive: 2, elections: electionsCreated },
  };
}
