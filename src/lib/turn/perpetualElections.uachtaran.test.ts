import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendDiscordWebhook: vi.fn().mockResolvedValue(undefined),
  sendDiscordEmbedWebhook: vi.fn().mockResolvedValue(undefined),
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {
    electionOpen: 0x00ff00,
    electionUpcoming: 0xffff00,
    billEnacted: 0x00ff00,
  },
}));

const NOW = new Date("2026-05-28T12:00:00Z");

function setupGameState(db: MockDb, currentTurn: number) {
  db.collectionMocks["gameState"]!.findOne = vi.fn().mockResolvedValue({
    _id: "current",
    currentTurn,
    preset: "2019-default",
    startingYear: 2019,
  });
}

describe("ensureIEUachtaranElections", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("elections");
    db.collection("gameState");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("is a no-op when an Uachtarán election is already active", async () => {
    setupGameState(db, 100);

    db.collectionMocks["elections"]!.find = vi
      .fn()
      .mockImplementation((filter: Record<string, unknown>) => {
        const status = filter.status as { $in: string[] } | undefined;
        const isLiveQuery = status?.$in?.includes("active");
        return {
          toArray: vi.fn().mockResolvedValue(
            isLiveQuery
              ? [
                  {
                    countryId: "IE",
                    electionType: "uachtaran",
                    state: "IE",
                    status: "active",
                    cycle: 1,
                  },
                ]
              : []
          ),
          sort: vi.fn().mockReturnThis(),
        };
      });

    const { ensureIEUachtaranElections } = await import("./perpetualElections");
    await ensureIEUachtaranElections(NOW);

    expect(db.collectionMocks["elections"]!.insertOne).not.toHaveBeenCalled();
  });

  it("spawns a new Uachtarán election when none active and none completed", async () => {
    // 7-year cycle anchored on 2025; under the 2019-default preset with
    // startingYear 2019 that's turn (2025 - 2019 + 1) * 48 = 336. Set
    // currentTurn close to that anchor so pickNextCanonicalCycle picks cycle 1.
    setupGameState(db, 300);

    db.collectionMocks["elections"]!.find = vi.fn().mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
    }));
    db.collectionMocks["elections"]!.findOne = vi.fn().mockResolvedValue(null);
    db.collectionMocks["elections"]!.insertOne = vi.fn().mockResolvedValue({});

    const { ensureIEUachtaranElections } = await import("./perpetualElections");
    await ensureIEUachtaranElections(NOW);

    expect(db.collectionMocks["elections"]!.insertOne).toHaveBeenCalledTimes(1);
    const insertedDoc = (db.collectionMocks["elections"]!.insertOne as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(insertedDoc.countryId).toBe("IE");
    expect(insertedDoc.electionType).toBe("uachtaran");
    expect(insertedDoc.state).toBe("IE");
    expect(insertedDoc.totalSeats).toBe(1);
  });
});
