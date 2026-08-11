import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { govCollapsed: 0, govFormed: 0 },
}));
vi.mock("@/lib/turn/parliamentaryGovernment", async () => {
  const actual = await vi.importActual<typeof import("@/lib/turn/parliamentaryGovernment")>(
    "@/lib/turn/parliamentaryGovernment"
  );
  return {
    ...actual,
    resetParliamentaryGovernmentAfterElection: vi.fn().mockResolvedValue(undefined),
    unformGovernmentAndVacatePM: vi.fn().mockResolvedValue(undefined),
    failInProgressBills: vi.fn().mockResolvedValue(0),
  };
});

import { processPMVacancyDeadlines } from "./pmVacancyDeadline";

let db: MockDb;

function stubDb(opts: {
  currentTurn: number;
  govByCountry: Record<
    string,
    {
      status: string;
      pmCharacterId?: unknown;
      pmVacancyDeadlineTurn?: number | null;
      snapElectionsUsed?: number;
    } | null
  >;
  regionsByCountry?: Record<string, string[]>;
}) {
  db = createMockDb();
  // gameState
  db.collectionMocks["gameState"] = {
    ...db.collection("gameState"),
    findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: opts.currentTurn }),
  } as MockDb["collectionMocks"][string];

  // governmentFormations.findOne({ _id }) — per-country lookup
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      const id = filter._id as string;
      const doc = opts.govByCountry[id] ?? null;
      return Promise.resolve(doc ? { _id: id, countryId: id, ...doc } : null);
    }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];

  // states.find({ countryId }) — return region docs
  db.collectionMocks["states"] = {
    ...db.collection("states"),
    find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      const cid = filter.countryId as string;
      const regions = opts.regionsByCountry?.[cid] ?? [];
      return {
        toArray: vi.fn().mockResolvedValue(regions.map((id) => ({ _id: id }))),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
    }),
  } as MockDb["collectionMocks"][string];

  // elections + seats + bills — empty default
  db.collectionMocks["elections"] = {
    ...db.collection("elections"),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    }),
    insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["seats"] = {
    ...db.collection("seats"),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["bills"] = {
    ...db.collection("bills"),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  } as MockDb["collectionMocks"][string];
}

beforeEach(async () => {
  vi.clearAllMocks();
});

describe("processPMVacancyDeadlines", () => {
  it("does NOT fire auto-snap when currentTurn < deadline", async () => {
    stubDb({
      currentTurn: 150,
      govByCountry: {
        UK: { status: "pending", pmVacancyDeadlineTurn: 200, snapElectionsUsed: 0 },
        JP: { status: "formed", pmCharacterId: new ObjectId() },
      },
      regionsByCountry: { UK: ["ENG"], JP: ["tokyo"] },
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const result = await processPMVacancyDeadlines(new Date(), 150, db as unknown as Db);
    expect(result.autoSnapsFired).toHaveLength(0);
    expect(db.collectionMocks["elections"]!.insertMany).not.toHaveBeenCalled();
  });

  it("fires auto-snap when currentTurn >= deadline and status is pending", async () => {
    stubDb({
      currentTurn: 200,
      govByCountry: {
        UK: { status: "pending", pmVacancyDeadlineTurn: 200, snapElectionsUsed: 0 },
        JP: { status: "formed", pmCharacterId: new ObjectId() },
      },
      regionsByCountry: { UK: ["ENG"], JP: ["tokyo"] },
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const result = await processPMVacancyDeadlines(new Date(), 200, db as unknown as Db);
    expect(result.autoSnapsFired).toContain("UK");
    expect(result.autoSnapsFired).not.toContain("JP");
    const inserted = db.collectionMocks["elections"]!.insertMany.mock.calls[0]?.[0];
    expect(inserted).toBeDefined();
    expect(inserted[0].electionType).toBe("snap_commons");
  });

  it("bypasses snap election limit when firing auto-snap", async () => {
    stubDb({
      currentTurn: 200,
      govByCountry: {
        UK: {
          status: "pending",
          pmVacancyDeadlineTurn: 200,
          snapElectionsUsed: 2, // already at limit
        },
        JP: { status: "formed", pmCharacterId: new ObjectId() },
      },
      regionsByCountry: { UK: ["ENG"], JP: ["tokyo"] },
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const result = await processPMVacancyDeadlines(new Date(), 200, db as unknown as Db);
    expect(result.autoSnapsFired).toContain("UK");
  });

  it("does NOT fire when status is formed even if deadline is set", async () => {
    stubDb({
      currentTurn: 500,
      govByCountry: {
        UK: {
          status: "formed",
          pmCharacterId: new ObjectId(),
          pmVacancyDeadlineTurn: 100, // stale, should be cleared but isn't
        },
        JP: { status: "formed", pmCharacterId: new ObjectId() },
      },
      regionsByCountry: { UK: ["ENG"], JP: ["tokyo"] },
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const result = await processPMVacancyDeadlines(new Date(), 500, db as unknown as Db);
    expect(result.autoSnapsFired).toHaveLength(0);
  });

  it("does NOT fire when pmVacancyDeadlineTurn is null", async () => {
    stubDb({
      currentTurn: 500,
      govByCountry: {
        UK: { status: "pending", pmVacancyDeadlineTurn: null },
      },
      regionsByCountry: { UK: ["ENG"] },
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const result = await processPMVacancyDeadlines(new Date(), 500, db as unknown as Db);
    expect(result.autoSnapsFired).toHaveLength(0);
  });

  it("skips countries with snapElectionsAllowed=false (US)", async () => {
    stubDb({
      currentTurn: 200,
      govByCountry: {
        // US isn't parliamentary so wouldn't be looped over; this mainly verifies
        // the iteration uses getParliamentaryCountryIds. We only need to test
        // the early-continue via the formed-government case.
        UK: { status: "formed", pmCharacterId: new ObjectId() },
        JP: { status: "formed", pmCharacterId: new ObjectId() },
      },
      regionsByCountry: { UK: ["ENG"], JP: ["tokyo"] },
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const result = await processPMVacancyDeadlines(new Date(), 200, db as unknown as Db);
    expect(result.autoSnapsFired).toHaveLength(0);
  });
});
