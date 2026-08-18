import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";

// The conflict factory is exercised for real. Only its two outside dependencies
// are stubbed: the shared sequential counter and the reserve-unit sweep, neither
// of which is what this test is about.
vi.mock("@/lib/db/sequentialId", () => ({
  getNextSequentialId: vi.fn().mockResolvedValue(7),
}));
vi.mock("@/lib/db/collections/militaryUnits", () => ({
  getMilitaryUnitsCollection: () => ({
    find: () => ({ project: () => ({ toArray: async () => [] }) }),
    updateMany: async () => undefined,
  }),
}));

import {
  syncVietnamFront,
  getVietnamFront,
  vietnamFrontIntensity,
  vietnamFrontSeverity,
  vietnamFrontStateForLevel,
  VIETNAM_FRONT_HOST,
  VIETNAM_FRONT_HOST_ENTITIES,
  VIETNAM_FRONT_ID,
  VIETNAM_FRONT_OPENS_AT,
} from "./vietnamFront";
import {
  emptyVietnamState,
  VIETNAM_MAX_LEVEL,
  VIETNAM_WAR_LEVEL,
  type VietnamEscalationState,
} from "./vietnamEscalation";

// ── A tiny in-memory stand-in for the one collection this touches. ───────────

function makeDb() {
  const conflicts = new Map<string, ConflictDoc>();
  const db = {
    conflicts,
    collection() {
      return {
        async findOne(filter: { _id: string }) {
          return conflicts.get(filter._id) ?? null;
        },
        async insertOne(doc: ConflictDoc) {
          conflicts.set(doc._id, doc);
          return { insertedId: doc._id };
        },
        async updateOne(filter: { _id: string }, update: { $set: Partial<ConflictDoc> }) {
          const existing = conflicts.get(filter._id);
          if (existing) conflicts.set(filter._id, { ...existing, ...update.$set });
        },
      };
    },
  };
  return db;
}

type FakeDb = ReturnType<typeof makeDb>;

function stateAt(level: number, over: Partial<VietnamEscalationState> = {}) {
  return { ...emptyVietnamState(), hasOpened: true, level, ...over };
}

const asDb = (db: FakeDb) => db as unknown as Db;

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = makeDb();
});

describe("Vietnam front", () => {
  describe("state mapping", () => {
    it("opens the front at the air campaign, not before", () => {
      expect(VIETNAM_FRONT_OPENS_AT).toBe(VIETNAM_WAR_LEVEL);
      for (let level = 1; level < VIETNAM_FRONT_OPENS_AT; level++) {
        expect(vietnamFrontStateForLevel(level)).toBe("winding_down");
      }
      for (let level = VIETNAM_FRONT_OPENS_AT; level <= VIETNAM_MAX_LEVEL; level++) {
        expect(vietnamFrontStateForLevel(level)).toBe("active");
      }
    });

    it("ends the front when the ladder is talked down to nothing", () => {
      expect(vietnamFrontStateForLevel(0)).toBe("resolved");
    });

    it("scales intensity and severity with the rung", () => {
      expect(vietnamFrontIntensity(0)).toBe(0);
      expect(vietnamFrontIntensity(VIETNAM_MAX_LEVEL)).toBe(100);
      let previous = -1;
      for (let level = 0; level <= VIETNAM_MAX_LEVEL; level++) {
        const intensity = vietnamFrontIntensity(level);
        expect(intensity).toBeGreaterThan(previous);
        previous = intensity;
      }
      expect(vietnamFrontSeverity(VIETNAM_MAX_LEVEL)).toBe("HIGH");
      expect(vietnamFrontSeverity(1)).toBe("LOW");
    });
  });

  describe("lifecycle", () => {
    it("creates nothing below the threshold", async () => {
      for (const level of [0, 1, 2, 3]) {
        expect(await syncVietnamFront(asDb(db), stateAt(level), 10)).toBeNull();
      }
      expect(db.conflicts.size).toBe(0);
    });

    it("opens a real proxy-war conflict on crossing the threshold", async () => {
      const action = await syncVietnamFront(asDb(db), stateAt(VIETNAM_FRONT_OPENS_AT), 42);
      expect(action).toBe("opened");

      const front = await getVietnamFront(asDb(db));
      expect(front).not.toBeNull();
      expect(front!._id).toBe(VIETNAM_FRONT_ID);
      expect(front!.type).toBe("cold_war");
      expect(front!.status).toBe("active");
      expect(front!.startTurn).toBe(42);
      expect(front!.createdBy).toBe("event");
      expect(front!.hostCountry).toBe(VIETNAM_FRONT_HOST);
      expect(front!.hostEntities).toEqual(VIETNAM_FRONT_HOST_ENTITIES);
      expect(front!.intensity).toBe(vietnamFrontIntensity(VIETNAM_FRONT_OPENS_AT));
    });

    it("ties the two sides to the blocs and to the real world entities", async () => {
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_FRONT_OPENS_AT), 42);
      const front = (await getVietnamFront(asDb(db)))!;

      expect(front.sideA.backer).toBe("west");
      expect(front.sideA.factionEntity).toBe("SVN");
      expect(front.sideB.backer).toBe("east");
      expect(front.sideB.factionEntity).toBe("NVN");
      // Contested is what blocOfSides reads from two opposing backers, and it is
      // what makes this render as a Cold War front rather than someone's civil war.
      expect(front.bloc).toBe("contested");
    });

    it("keeps the superpowers off the belligerent rosters", async () => {
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_MAX_LEVEL), 42);
      const front = (await getVietnamFront(asDb(db)))!;
      // A crisis decision must not silently declare a world war. Both patrons are
      // backers, never belligerents, which is the generated-faction contract.
      expect(front.sideA.countries).toEqual([]);
      expect(front.sideB.countries).toEqual([]);
      expect(front.sideA.kind).toBe("generated");
      expect(front.sideB.kind).toBe("generated");
    });

    it("opens the front on the parallel, with neither side holding the country", async () => {
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_FRONT_OPENS_AT), 42);
      const front = (await getVietnamFront(asDb(db)))!;
      expect(front.control).toBe(50);
      expect(front.controlStart).toBe(50);
    });

    it("is idempotent while the rung does not move", async () => {
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_FRONT_OPENS_AT), 42);
      const again = await syncVietnamFront(asDb(db), stateAt(VIETNAM_FRONT_OPENS_AT), 43);
      expect(again).toBeNull();
      expect(db.conflicts.size).toBe(1);
    });

    it("raises intensity as the war climbs without churning the status", async () => {
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_FRONT_OPENS_AT), 42);
      const before = (await getVietnamFront(asDb(db)))!.intensity;
      const action = await syncVietnamFront(asDb(db), stateAt(VIETNAM_MAX_LEVEL), 50);
      const after = (await getVietnamFront(asDb(db)))!;
      expect(after.intensity).toBeGreaterThan(before);
      expect(after.status).toBe("active");
      // Intensity moved but the lifecycle did not, so there is nothing to announce.
      expect(action).toBeNull();
    });

    it("winds the front down when the ladder falls below the threshold", async () => {
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_MAX_LEVEL), 42);
      const action = await syncVietnamFront(asDb(db), stateAt(VIETNAM_FRONT_OPENS_AT - 1), 60);
      expect(action).toBe("wound_down");
      expect((await getVietnamFront(asDb(db)))!.status).toBe("winding_down");
    });

    it("brings the front back up if the superpowers escalate again", async () => {
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_MAX_LEVEL), 42);
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_FRONT_OPENS_AT - 1), 60);
      const action = await syncVietnamFront(asDb(db), stateAt(VIETNAM_FRONT_OPENS_AT), 70);
      expect(action).toBe("reopened");
      expect((await getVietnamFront(asDb(db)))!.status).toBe("active");
    });

    it("ends the war as a stalemate when the ladder reaches zero", async () => {
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_MAX_LEVEL), 42);
      const action = await syncVietnamFront(asDb(db), stateAt(0), 90);
      expect(action).toBe("ended");

      const front = (await getVietnamFront(asDb(db)))!;
      expect(front.status).toBe("resolved");
      expect(front.endTurn).toBe(90);
      // Neither faction won. Both patrons walked away.
      expect(front.outcome?.winner).toBe("stalemate");
    });

    it("never resurrects a resolved front", async () => {
      await syncVietnamFront(asDb(db), stateAt(VIETNAM_MAX_LEVEL), 42);
      await syncVietnamFront(asDb(db), stateAt(0), 90);

      const action = await syncVietnamFront(asDb(db), stateAt(VIETNAM_MAX_LEVEL), 120);
      expect(action).toBeNull();
      const front = (await getVietnamFront(asDb(db)))!;
      expect(front.status).toBe("resolved");
      expect(front.endTurn).toBe(90);
      expect(db.conflicts.size).toBe(1);
    });

    it("runs a full climb, wind-down and end in one sequence", async () => {
      const seen: Array<string | null> = [];
      for (const [level, turn] of [
        [1, 10],
        [3, 20],
        [4, 30],
        [6, 40],
        [2, 50],
        [0, 60],
      ] as const) {
        seen.push(await syncVietnamFront(asDb(db), stateAt(level), turn));
      }
      expect(seen).toEqual([null, null, "opened", null, "wound_down", "ended"]);
    });
  });
});
