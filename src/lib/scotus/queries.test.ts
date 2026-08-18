import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  DIVERGENT_TENURE_FLOOR_TURNS,
  DIVERGENT_TENURE_HAZARD_PER_TURN,
} from "@/lib/scotus/tenure";

vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

describe("getScotusComposition", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("supremeCourtSeats");
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 200 } as never);
  });

  it("surfaces the live death chance on an occupied divergent seat", async () => {
    const cursor = {
      sort: vi.fn(),
      toArray: vi.fn().mockResolvedValue([
        {
          seatNumber: 1,
          isDivergent: true,
          justiceMode: "character",
          justiceCharacterId: new ObjectId(),
          justiceNppId: null,
          justiceName: "Lyndon B. Johnson",
          justiceParty: "1",
          economicLean: -1,
          socialLean: -1,
          seatedAtTurn: 100,
          divergentHazardStartsTurn: 100 + DIVERGENT_TENURE_FLOOR_TURNS,
        },
      ]),
    };
    cursor.sort.mockReturnValue(cursor);
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue(cursor);

    const { getScotusComposition } = await import("./queries");
    const seats = await getScotusComposition(db as unknown as Db, "US");

    expect(seats).toEqual([
      expect.objectContaining({
        seatNumber: 1,
        vacant: false,
        isDivergent: true,
        deathChance: {
          chancePerTurn: DIVERGENT_TENURE_HAZARD_PER_TURN,
          turnsUntilActive: 0,
        },
      }),
    ]);
  });

  it("omits death chance on vacant and historical seats", async () => {
    const cursor = {
      sort: vi.fn(),
      toArray: vi.fn().mockResolvedValue([
        {
          seatNumber: 1,
          isDivergent: true,
          justiceMode: null,
          justiceCharacterId: null,
          justiceNppId: null,
          justiceName: null,
          justiceParty: null,
          economicLean: null,
          socialLean: null,
          divergentHazardStartsTurn: null,
        },
        {
          seatNumber: 2,
          isDivergent: false,
          justiceMode: "historical",
          justiceCharacterId: null,
          justiceNppId: null,
          justiceName: "Earl Warren",
          justiceParty: "1",
          economicLean: -1,
          socialLean: -1,
          divergentHazardStartsTurn: null,
        },
      ]),
    };
    cursor.sort.mockReturnValue(cursor);
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue(cursor);

    const { getScotusComposition } = await import("./queries");
    const seats = await getScotusComposition(db as unknown as Db, "US");

    expect(seats[0]).toEqual(expect.objectContaining({ vacant: true, deathChance: null }));
    expect(seats[1]).toEqual(
      expect.objectContaining({ vacant: false, isDivergent: false, deathChance: null })
    );
  });
});
