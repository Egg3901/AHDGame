/**
 * Integration tests for POST /api/country/[code]/pm/snap-election.
 *
 * Covers the PM-only gate, country eligibility, limit/cooldown errors, and
 * the happy path for JP (snap_shugiin), UK (snap_commons), and DE
 * (snap_bundestag).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    effectiveNow: new Date("2026-01-15T12:00:00.000Z"),
    currentTurn: 100,
    lastTurnProcessed: new Date("2026-01-15T11:00:00.000Z"),
    pausedAt: null,
    isActive: true,
  }),
}));
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
    cancelActiveNoConfidenceVotes: vi.fn().mockResolvedValue(0),
  };
});

const PM_CHAR_ID = new ObjectId();
const NOT_PM_ID = new ObjectId();

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));

let db: MockDb;

function installDb(opts: {
  govByCountry: Record<
    string,
    {
      status: string;
      pmCharacterId?: unknown;
      snapElectionsUsed?: number;
      lastSnapElectionTurn?: number | null;
    } | null
  >;
  regions?: Record<string, string[]>;
  currentTurn?: number;
}) {
  db = createMockDb();
  db.collectionMocks["gameState"] = {
    ...db.collection("gameState"),
    findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: opts.currentTurn ?? 100 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      const doc = opts.govByCountry[filter._id as string] ?? null;
      return Promise.resolve(
        doc ? { _id: filter._id as string, countryId: filter._id as string, ...doc } : null
      );
    }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["states"] = {
    ...db.collection("states"),
    find: vi.fn().mockImplementation((filter: Record<string, unknown>) => ({
      toArray: vi
        .fn()
        .mockResolvedValue(
          (opts.regions?.[filter.countryId as string] ?? []).map((id) => ({ _id: id }))
        ),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    })),
  } as MockDb["collectionMocks"][string];
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

async function authAsSittingPM() {
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: new ObjectId(),
      username: "pm",
      isAdmin: false,
      character: { _id: PM_CHAR_ID, name: "Test PM" },
    },
  } as unknown as Awaited<ReturnType<typeof requireAuthWithCharacter>>);
}

async function authAsNonPM() {
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: new ObjectId(),
      username: "nopm",
      isAdmin: false,
      character: { _id: NOT_PM_ID, name: "Not PM" },
    },
  } as unknown as Awaited<ReturnType<typeof requireAuthWithCharacter>>);
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  installDb({
    govByCountry: {
      JP: {
        status: "formed",
        pmCharacterId: PM_CHAR_ID,
        snapElectionsUsed: 0,
        lastSnapElectionTurn: null,
      },
    },
    regions: { JP: ["tokyo"] },
  });
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("POST /api/country/jp/pm/snap-election", () => {
  it("happy path: returns success, spawns snap_shugiin, returns counters", async () => {
    await authAsSittingPM();
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/country/jp/pm/snap-election"), {
      params: Promise.resolve({ code: "jp" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.snapElectionsUsed).toBe(1);
    expect(data.snapElectionsRemaining).toBe(1);

    const inserted = db.collectionMocks["elections"]!.insertMany.mock.calls[0]?.[0];
    expect(inserted[0].electionType).toBe("snap_shugiin");
    expect(inserted[0].countryId).toBe("JP");
  });

  it("returns 403 when the viewer is not the sitting PM", async () => {
    await authAsNonPM();
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/country/jp/pm/snap-election"), {
      params: Promise.resolve({ code: "jp" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when country disallows snap elections (US)", async () => {
    await authAsSittingPM();
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/country/us/pm/snap-election"), {
      params: Promise.resolve({ code: "us" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the snap limit is reached", async () => {
    const { getDb } = await import("@/lib/mongodb");
    installDb({
      govByCountry: {
        JP: { status: "formed", pmCharacterId: PM_CHAR_ID, snapElectionsUsed: 2 },
      },
      regions: { JP: ["tokyo"] },
    });
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    await authAsSittingPM();
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/country/jp/pm/snap-election"), {
      params: Promise.resolve({ code: "jp" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/limit/i);
  });

  it("UK route spawns snap_commons not snap_shugiin", async () => {
    const { getDb } = await import("@/lib/mongodb");
    installDb({
      govByCountry: {
        UK: { status: "formed", pmCharacterId: PM_CHAR_ID, snapElectionsUsed: 0 },
      },
      regions: { UK: ["ENG"] },
    });
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    await authAsSittingPM();
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/country/uk/pm/snap-election"), {
      params: Promise.resolve({ code: "uk" }),
    });
    expect(res.status).toBe(200);
    const inserted = db.collectionMocks["elections"]!.insertMany.mock.calls[0]?.[0];
    expect(inserted[0].electionType).toBe("snap_commons");
    expect(inserted[0].countryId).toBe("UK");
  });

  it("DE route spawns snap_bundestag", async () => {
    const { getDb } = await import("@/lib/mongodb");
    installDb({
      govByCountry: {
        DE: { status: "formed", pmCharacterId: PM_CHAR_ID, snapElectionsUsed: 0 },
      },
      regions: { DE: ["BY"] },
    });
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    await authAsSittingPM();
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/country/de/pm/snap-election"), {
      params: Promise.resolve({ code: "de" }),
    });
    expect(res.status).toBe(200);
    const inserted = db.collectionMocks["elections"]!.insertMany.mock.calls[0]?.[0];
    expect(inserted[0].electionType).toBe("snap_bundestag");
    expect(inserted[0].countryId).toBe("DE");
  });
});
