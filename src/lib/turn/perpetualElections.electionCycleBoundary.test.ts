/**
 * Issue #2060: country election families respawn one engine turn late with
 * shortened primary windows.
 *
 * Production shape: a prior cycle ends at turn 192 (last update during raw
 * 192) while the persisted `gameState.currentTurn` is still 192 during raw
 * 193 processing. The authoritative in-flight turn (`newTurn = 193`) must
 * drive the country spawners; reloading the stale persisted turn makes
 * `justResolvedInSameTurn` suppress the next race for a full turn, and the
 * families finally created on raw 194 start with an already-elapsed primary
 * window.
 *
 * Covers one family per named country from the issue: IE localCouncil, JP
 * shugiin, JP regionalCouncil (Shugiin mirror), RU republicSupremeSoviet, FR
 * senat.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Election, State } from "@/lib/db/types";
import { turnToWallClock } from "@/lib/elections/canonicalCycle";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/discordWebhooks", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/discordWebhooks")>();
  return {
    ...original,
    sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  };
});

const MS_PER_TURN = 3_600_000;
// Mirrors the issue's sandbox timestamps: raw 192 closes at 16:28, raw 193 opens.
const NOW_193 = new Date("2026-09-17T17:28:41.101Z");
const NOW_194 = new Date(NOW_193.getTime() + MS_PER_TURN);
const PREV_UPDATED_AT = new Date("2026-09-17T17:26:23.238Z");

interface FamilySeed {
  countryId: string;
  electionType: string;
  regions: { id: string; seats: number }[];
}

const FAMILIES: FamilySeed[] = [
  {
    countryId: "IE",
    electionType: "localCouncil",
    regions: [
      { id: "DUB", seats: 62 },
      { id: "COR", seats: 25 },
    ],
  },
  {
    countryId: "JP",
    electionType: "shugiin",
    regions: [
      { id: "KAN", seats: 10 },
      { id: "KYO", seats: 8 },
    ],
  },
  {
    countryId: "JP",
    electionType: "regionalCouncil",
    regions: [
      { id: "KAN", seats: 10 },
      { id: "KYO", seats: 8 },
    ],
  },
  {
    countryId: "RU",
    electionType: "republicSupremeSoviet",
    regions: [
      { id: "MOS", seats: 12 },
      { id: "LEN", seats: 9 },
    ],
  },
  {
    countryId: "FR",
    electionType: "senat",
    regions: [
      { id: "IDF", seats: 11 },
      { id: "PAC", seats: 7 },
    ],
  },
];

/** A completed cycle-1 race per family region, ending at turn 192. */
function seedCompletedCycle(elections: Election[]): void {
  for (const family of FAMILIES) {
    for (const region of family.regions) {
      elections.push({
        _id: new ObjectId(),
        countryId: family.countryId,
        electionType: family.electionType,
        state: region.id,
        cycle: 1,
        status: "completed",
        totalSeats: region.seats,
        startTurn: 144,
        primaryEndTurn: 168,
        endTurn: 192,
        startTime: new Date(PREV_UPDATED_AT.getTime() - 48 * MS_PER_TURN),
        primaryEndTime: new Date(PREV_UPDATED_AT.getTime() - 24 * MS_PER_TURN),
        endTime: new Date(PREV_UPDATED_AT.getTime()),
        durationHours: 48,
        primaryDurationHours: 24,
        createdAt: new Date(PREV_UPDATED_AT.getTime() - 48 * MS_PER_TURN),
        updatedAt: PREV_UPDATED_AT,
      } as Election);
    }
  }
}

/**
 * Convert a typed fixture doc to a plain record at the mock boundary, so the
 * in-memory matcher never needs an Election-to-Record cast.
 */
function asRecord(doc: Election | State): Record<string, unknown> {
  return { ...doc };
}

const SORTABLE_DATE_FIELDS: ReadonlySet<string> = new Set([
  "createdAt",
  "updatedAt",
  "startTime",
  "endTime",
  "primaryEndTime",
]);

/** Millis for a sortable date field, read through keyof with a Date guard. */
function electionTime(doc: Election, field: string): number {
  if (!SORTABLE_DATE_FIELDS.has(field)) return 0;
  const value = doc[field as keyof Election];
  if (value instanceof Date) return value.getTime();
  return 0;
}

/**
 * Narrow an optional production field the spawner must have set. Fails the
 * test on a missing field instead of hiding the gap behind `!`.
 */
function requireDefined<T>(value: T | undefined, label: string): T {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error(`spawned election is missing ${label}`);
  return value;
}

function matchesDoc(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") {
      if (!(cond as Record<string, unknown>[]).some((branch) => matchesDoc(doc, branch))) {
        return false;
      }
      continue;
    }
    const value = doc[key];
    if (
      cond != null &&
      typeof cond === "object" &&
      !(cond instanceof Date) &&
      !(cond instanceof ObjectId) &&
      !Array.isArray(cond)
    ) {
      const ops = cond as Record<string, unknown>;
      if ("$in" in ops) {
        const options = ops.$in as unknown[];
        if (!options.some((option) => String(option) === String(value))) return false;
        continue;
      }
      return false;
    }
    if (String(value) !== String(cond)) return false;
  }
  return true;
}

interface Mount {
  elections: Election[];
  world: Record<string, unknown>;
}

function mountDb(mount: Mount): void {
  const states: State[] = [];
  for (const family of FAMILIES) {
    for (const region of family.regions) {
      if (states.some((s) => s._id === region.id)) continue;
      states.push({
        _id: region.id,
        countryId: family.countryId,
        houseDistricts: region.seats,
        stateSenateSeats: region.seats,
      } as State);
    }
  }
  const access: Record<string, unknown> = {
    RU: { _id: "RU", status: "active" },
    FR: { _id: "FR", status: "beta", enabledForPlayers: true },
  };
  const electionsApi = {
    find: (filter: Record<string, unknown> = {}) => {
      const rows = mount.elections.filter((doc) => matchesDoc(asRecord(doc), filter));
      return {
        sort: (spec: Record<string, 1 | -1>) => {
          const [[field, direction]] = Object.entries(spec);
          const sorted = [...rows].sort((a, b) => {
            const left = electionTime(a, field);
            const right = electionTime(b, field);
            return direction === -1 ? right - left : left - right;
          });
          return { toArray: () => Promise.resolve(sorted) };
        },
        toArray: () => Promise.resolve(rows),
      };
    },
    findOne: async (filter: Record<string, unknown> = {}) =>
      mount.elections.find((doc) => matchesDoc(asRecord(doc), filter)) ?? null,
    insertMany: async (docs: Omit<Election, "_id">[]) => {
      for (const doc of docs) mount.elections.push({ _id: new ObjectId(), ...doc } as Election);
      return { insertedCount: docs.length, insertedIds: {} };
    },
    insertOne: async (doc: Omit<Election, "_id">) => {
      const inserted = { _id: new ObjectId(), ...doc } as Election;
      mount.elections.push(inserted);
      return { insertedId: inserted._id };
    },
    bulkWrite: async (
      ops: {
        updateOne: { filter: Record<string, unknown>; update: { $set: Record<string, unknown> } };
      }[]
    ) => {
      for (const op of ops) {
        const target = mount.elections.find((doc) =>
          matchesDoc(asRecord(doc), op.updateOne.filter)
        );
        if (target) Object.assign(target, op.updateOne.update.$set);
      }
      return { modifiedCount: ops.length };
    },
  };
  const statesApi = {
    find: (filter: Record<string, unknown> = {}) => ({
      toArray: () => Promise.resolve(states.filter((doc) => matchesDoc(asRecord(doc), filter))),
    }),
    findOne: async () => null,
  };
  const gameStateApi = {
    findOne: async () => mount.world,
  };
  const accessApi = {
    findOne: async (filter: Record<string, unknown> = {}) =>
      (access[String(filter._id)] as never) ?? null,
  };
  return void (async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") return electionsApi;
        if (name === "states") return statesApi;
        if (name === "gameState") return gameStateApi;
        if (name === "countryGameStates") return accessApi;
        return {
          find: () => ({ toArray: () => Promise.resolve([]) }),
          findOne: () => Promise.resolve(null),
        };
      }),
    } as never);
  })();
}

function freshMount(): Mount {
  const elections: Election[] = [];
  seedCompletedCycle(elections);
  return {
    elections,
    world: {
      _id: "current",
      currentTurn: 192,
      currentYear: 1956,
      startingYear: 1953,
      preset: "1953-default",
      lastTurnProcessed: new Date(NOW_193.getTime() - MS_PER_TURN),
    },
  };
}

/** Run every named family spawner in registry order (shugiin before its mirror). */
async function runBoundarySpawners(now: Date, currentTurn?: number): Promise<void> {
  const { ensureIELocalCouncilElections } = await import("./perpetualElections/countries/ie");
  const { ensureJPElections, ensureJPRegionalCouncilElections } =
    await import("./perpetualElections/countries/jp");
  const { ensureRURepublicSovietElections } = await import("./perpetualElections/countries/ru");
  const { ensureFRSenateElections } =
    await import("./perpetualElections/countries/betaParliaments");
  await ensureIELocalCouncilElections(now, currentTurn);
  await ensureJPElections(now, currentTurn);
  await ensureJPRegionalCouncilElections(now, currentTurn);
  await ensureRURepublicSovietElections(now, currentTurn);
  await ensureFRSenateElections(now, currentTurn);
}

function liveDocs(mount: Mount, countryId: string, electionType: string): Election[] {
  return mount.elections.filter(
    (e) =>
      e.countryId === countryId &&
      e.electionType === electionType &&
      (e.status === "active" || e.status === "upcoming")
  );
}

describe("issue #2060: country cycles respawn on the first post-resolution turn", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reproduces the boundary: the stale persisted turn (192) spawns nothing on raw 193", async () => {
    const mount = freshMount();
    mountDb(mount);
    // No authoritative turn threaded: spawners reload gameState.currentTurn (192).
    await runBoundarySpawners(NOW_193);
    for (const family of FAMILIES) {
      expect(liveDocs(mount, family.countryId, family.electionType)).toHaveLength(0);
    }
  });

  it("spawns every named family on raw 193 with the authoritative turn", async () => {
    const mount = freshMount();
    mountDb(mount);
    await runBoundarySpawners(NOW_193, 193);
    for (const family of FAMILIES) {
      const live = liveDocs(mount, family.countryId, family.electionType);
      expect(live).toHaveLength(family.regions.length);
      for (const doc of live) {
        expect(doc.cycle).toBe(2);
        expect(doc.createdAt).toEqual(NOW_193);
      }
    }
  });

  it("immediate-open families start on the creation turn with a full primary window", async () => {
    const mount = freshMount();
    mountDb(mount);
    await runBoundarySpawners(NOW_193, 193);
    for (const [countryId, electionType] of [
      ["IE", "localCouncil"],
      ["RU", "republicSupremeSoviet"],
      ["FR", "senat"],
    ] as const) {
      for (const doc of liveDocs(mount, countryId, electionType)) {
        expect(doc.status).toBe("active");
        const startTurn = requireDefined(doc.startTurn, "startTurn");
        const startTime = requireDefined(doc.startTime, "startTime");
        const primaryEndTurn = requireDefined(doc.primaryEndTurn, "primaryEndTurn");
        const primaryEndTime = requireDefined(doc.primaryEndTime, "primaryEndTime");
        const primaryDurationHours = requireDefined(
          doc.primaryDurationHours,
          "primaryDurationHours"
        );
        expect(startTurn).toBe(193);
        expect(startTime).toEqual(NOW_193);
        // The whole primary still lies ahead, not one turn already elapsed.
        expect(primaryEndTurn - startTurn).toBeGreaterThanOrEqual(primaryDurationHours);
        expect(primaryEndTime.getTime()).toBeGreaterThan(startTime.getTime());
      }
    }
  });

  it("canonical JP families stay clock-consistent with the in-flight turn", async () => {
    const mount = freshMount();
    mountDb(mount);
    await runBoundarySpawners(NOW_193, 193);
    const shugiin = liveDocs(mount, "JP", "shugiin");
    expect(shugiin).toHaveLength(2);
    for (const doc of shugiin) {
      // Anchored to the in-flight clock, not the stale persisted turn.
      expect(requireDefined(doc.startTime, "startTime")).toEqual(
        turnToWallClock(requireDefined(doc.startTurn, "startTurn"), NOW_193, 193)
      );
      // Primary still open: the window is eroded by history, never elapsed at birth.
      expect(requireDefined(doc.primaryEndTurn, "primaryEndTurn")).toBeGreaterThan(193);
      expect(doc.status).toBe("active");
    }
    // Regional councils mirror the live Shugiin schedule exactly.
    const councils = liveDocs(mount, "JP", "regionalCouncil");
    expect(councils).toHaveLength(2);
    for (const council of councils) {
      const mirror = requireDefined(
        shugiin.find((s) => s.state === council.state),
        `shugiin mirror for ${council.state}`
      );
      expect(council.cycle).toBe(mirror.cycle);
      expect(council.startTurn).toBe(mirror.startTurn);
      expect(council.startTime).toEqual(mirror.startTime);
      expect(council.primaryEndTurn).toBe(mirror.primaryEndTurn);
      expect(council.endTurn).toBe(mirror.endTurn);
    }
  });

  it("replay with the same turn is idempotent", async () => {
    const mount = freshMount();
    mountDb(mount);
    await runBoundarySpawners(NOW_193, 193);
    const before = mount.elections.length;
    await runBoundarySpawners(NOW_193, 193);
    expect(mount.elections.length).toBe(before);
    for (const family of FAMILIES) {
      expect(liveDocs(mount, family.countryId, family.electionType)).toHaveLength(
        family.regions.length
      );
    }
  });

  it("the next turn creates no duplicate cycle documents", async () => {
    const mount = freshMount();
    mountDb(mount);
    await runBoundarySpawners(NOW_193, 193);
    // Persist raw 193, then process raw 194 with its authoritative turn.
    mount.world.currentTurn = 193;
    mount.world.lastTurnProcessed = NOW_193;
    const before = mount.elections.length;
    await runBoundarySpawners(NOW_194, 194);
    expect(mount.elections.length).toBe(before);
    for (const family of FAMILIES) {
      const live = liveDocs(mount, family.countryId, family.electionType);
      expect(live).toHaveLength(family.regions.length);
      expect(new Set(live.map((doc) => `${doc.state}:${doc.cycle}`)).size).toBe(
        family.regions.length
      );
    }
  });
});
