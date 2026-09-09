import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { DIVERGENT_TENURE_FLOOR_TURNS } from "@/lib/scotus/tenure";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/scotus/scotusNews", () => ({
  generateScotusVacancyNews: vi.fn().mockResolvedValue(undefined),
}));

describe("processScotusTenureTurn", () => {
  let db: MockDb;
  const startingYear = 1953;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 1, startingYear } as never);
    db.collection("supremeCourtSeats");
    db.collection("characters");
    db.collection("electedOfficials");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds a scripted departure until the CALENDAR year reaches it (#1208)", async () => {
    // Founding-phase world: raw turn 49 is calendar turn 1, still 1953, so the
    // 1954 departure is not due yet. Off the raw turn the seat turned over a
    // full game year early.
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 49,
      startingYear,
      preIterationTurns: 48,
    } as never);
    const seatId = new ObjectId();
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: seatId,
          countryId: "US",
          seatNumber: 1,
          isDivergent: false,
          justiceMode: "historical",
          justiceName: "Justice A",
          historicalOccupantIndex: 0,
          historicalOccupants: [
            {
              key: "a",
              name: "Justice A",
              economicLean: 2,
              socialLean: 2,
              seatedYear: 1953,
              departureYear: 1954,
              departureReason: "retirement",
            },
            {
              key: "b",
              name: "Justice B",
              economicLean: -2,
              socialLean: -2,
              seatedYear: 1954,
              departureYear: null,
              departureReason: null,
            },
          ],
        },
      ]),
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const result = await processScotusTenureTurn(49, db as unknown as Db);

    expect(result).toEqual({ seatsAdvanced: 0, seatsVacatedByHistory: 0, seatsVacatedByHazard: 0 });
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).not.toHaveBeenCalled();
  });

  it("opens a playable vacancy instead of auto-seating the next historical occupant (#1289)", async () => {
    const seatId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 1,
      isDivergent: false,
      justiceMode: "historical",
      justiceName: "Justice A",
      historicalOccupantIndex: 0,
      historicalOccupants: [
        {
          key: "a",
          name: "Justice A",
          economicLean: 2,
          socialLean: 2,
          seatedYear: 1953,
          departureYear: 1954, // -> turn 49
          departureReason: "retirement",
        },
        {
          key: "b",
          name: "Justice B",
          economicLean: -2,
          socialLean: -2,
          seatedYear: 1954,
          departureYear: null,
          departureReason: null,
        },
      ],
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    // Turn 49 = (1954 - 1953) * 48 + 1
    const result = await processScotusTenureTurn(49, db as unknown as Db);

    expect(result).toEqual({ seatsAdvanced: 0, seatsVacatedByHistory: 1, seatsVacatedByHazard: 0 });
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).toHaveBeenCalledWith(
      { _id: seatId, justiceMode: "historical" },
      expect.objectContaining({
        $set: expect.objectContaining({
          justiceMode: null,
          justiceCharacterId: null,
          justiceNppId: null,
          justiceName: null,
        }),
      })
    );
  });

  it("vacates a seat (not divergent) once the Original Roster chain is exhausted", async () => {
    const seatId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 2,
      isDivergent: false,
      justiceMode: "historical",
      justiceName: "Justice Solo",
      historicalOccupantIndex: 0,
      historicalOccupants: [
        {
          key: "solo",
          name: "Justice Solo",
          economicLean: 1,
          socialLean: 1,
          seatedYear: 1953,
          departureYear: 1954,
          departureReason: "death",
        },
      ],
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const result = await processScotusTenureTurn(49, db as unknown as Db);

    expect(result).toEqual({ seatsAdvanced: 0, seatsVacatedByHistory: 1, seatsVacatedByHazard: 0 });
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).toHaveBeenCalledWith(
      { _id: seatId, justiceMode: "historical" },
      expect.objectContaining({
        $set: expect.objectContaining({
          justiceMode: null,
          justiceCharacterId: null,
          justiceName: null,
        }),
      })
    );
  });

  it("does not re-fire a scripted departure on an already-vacated Original Roster seat", async () => {
    // #1627 opened the vacancy but left nothing marking the departure as spent:
    // the seat still points at the departed occupant, whose departure year stays
    // in the past forever, so every later turn re-vacated it and re-posted the
    // wire. Live seat #8 wired the same "SCOTUS Seat #8 Vacant" post every hour.
    const seatId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 8,
      isDivergent: false,
      justiceMode: null,
      justiceCharacterId: null,
      justiceNppId: null,
      justiceName: null,
      seatedAtTurn: null,
      historicalOccupantIndex: 0,
      historicalOccupants: [
        {
          key: "clark",
          name: "Tom C. Clark",
          economicLean: 1,
          socialLean: 1,
          seatedYear: 1953,
          departureYear: 1954,
          departureReason: "retirement",
        },
        {
          key: "marshall",
          name: "Thurgood Marshall",
          economicLean: -3,
          socialLean: -3,
          seatedYear: 1954,
          departureYear: null,
          departureReason: null,
        },
      ],
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const { generateScotusVacancyNews } = await import("@/lib/scotus/scotusNews");
    const { createNotifications } = await import("@/lib/notifications");
    // Well past the 1954 departure, the way the live world is decades past 1967.
    const result = await processScotusTenureTurn(500, db as unknown as Db);

    expect(result).toEqual({ seatsAdvanced: 0, seatsVacatedByHistory: 0, seatsVacatedByHazard: 0 });
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).not.toHaveBeenCalled();
    expect(generateScotusVacancyNews).not.toHaveBeenCalled();
    expect(createNotifications).toHaveBeenCalledWith([]);
  });

  it("leaves a malformed non-divergent seat carrying a live justiceMode to the confirmation flow", async () => {
    // An Original Roster seat's only legitimate occupant is a scripted one. A
    // non-divergent seat claiming "character" is malformed, so the historical
    // clock must not vacate it out from under whoever actually holds it.
    const seatId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 5,
      isDivergent: false,
      justiceMode: "character",
      justiceCharacterId: null,
      justiceNppId: null,
      justiceName: "Somehow Seated",
      historicalOccupantIndex: 0,
      historicalOccupants: [
        {
          key: "a",
          name: "Justice A",
          economicLean: 2,
          socialLean: 2,
          seatedYear: 1953,
          departureYear: 1954,
          departureReason: "retirement",
        },
      ],
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const { generateScotusVacancyNews } = await import("@/lib/scotus/scotusNews");
    const result = await processScotusTenureTurn(500, db as unknown as Db);

    expect(result).toEqual({ seatsAdvanced: 0, seatsVacatedByHistory: 0, seatsVacatedByHazard: 0 });
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).not.toHaveBeenCalled();
    expect(generateScotusVacancyNews).not.toHaveBeenCalled();
  });

  it("stays silent when a concurrent turn processor won the vacate race", async () => {
    // Overlapping turn runs during a rolling deploy both read the seat before
    // either writes. The compare-and-set on justiceMode decides the winner; the
    // loser matches nothing and must not post a second vacancy wire.
    const seatId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 8,
      isDivergent: false,
      justiceMode: "historical",
      justiceCharacterId: null,
      justiceNppId: null,
      justiceName: "Tom C. Clark",
      historicalOccupantIndex: 0,
      historicalOccupants: [
        {
          key: "clark",
          name: "Tom C. Clark",
          economicLean: 1,
          socialLean: 1,
          seatedYear: 1953,
          departureYear: 1954,
          departureReason: "retirement",
        },
      ],
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });
    // The other processor got there first.
    db.collectionMocks.supremeCourtSeats!.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const { generateScotusVacancyNews } = await import("@/lib/scotus/scotusNews");
    const { createNotifications } = await import("@/lib/notifications");
    const result = await processScotusTenureTurn(49, db as unknown as Db);

    expect(db.collectionMocks.supremeCourtSeats!.updateOne).toHaveBeenCalledWith(
      { _id: seatId, justiceMode: "historical" },
      expect.anything()
    );
    expect(result).toEqual({ seatsAdvanced: 0, seatsVacatedByHistory: 0, seatsVacatedByHazard: 0 });
    expect(generateScotusVacancyNews).not.toHaveBeenCalled();
    expect(createNotifications).toHaveBeenCalledWith([]);
  });

  it("never departs a divergent justice before the tenure floor, regardless of the random draw", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.0001); // would depart if the hazard were live
    const seatId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 3,
      isDivergent: true,
      historicalOccupants: [],
      justiceCharacterId: null,
      justiceNppId: new ObjectId(),
      seatedAtTurn: 100,
      divergentHazardStartsTurn: 100 + DIVERGENT_TENURE_FLOOR_TURNS,
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const result = await processScotusTenureTurn(150, db as unknown as Db); // still before the floor
    expect(result.seatsVacatedByHazard).toBe(0);
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).not.toHaveBeenCalled();
  });

  it("rolls a divergent departure past the floor when the random draw is under the hazard", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.0001);
    const seatId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 4,
      isDivergent: true,
      historicalOccupants: [],
      justiceMode: "npp",
      justiceCharacterId: null,
      justiceNppId: new ObjectId(),
      justiceName: "NPP Scholar",
      seatedAtTurn: 100,
      divergentHazardStartsTurn: 100 + DIVERGENT_TENURE_FLOOR_TURNS,
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const result = await processScotusTenureTurn(
      100 + DIVERGENT_TENURE_FLOOR_TURNS,
      db as unknown as Db
    );

    expect(result.seatsVacatedByHazard).toBe(1);
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).toHaveBeenCalledWith(
      { _id: seatId, justiceMode: "npp" },
      expect.objectContaining({
        $set: expect.objectContaining({ justiceCharacterId: null, justiceMode: null }),
      })
    );
  });

  it("vacates a player-held divergent seat when the hazard fires and notifies the occupant", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.0001);
    const seatId = new ObjectId();
    const occupantCharId = new ObjectId();
    const occupantUserId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 1,
      isDivergent: true,
      historicalOccupants: [],
      justiceMode: "character",
      justiceCharacterId: occupantCharId,
      justiceNppId: null,
      justiceName: "Lyndon B. Johnson",
      seatedAtTurn: 100,
      divergentHazardStartsTurn: 100 + DIVERGENT_TENURE_FLOOR_TURNS,
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: occupantCharId,
      userId: occupantUserId,
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const { createNotifications } = await import("@/lib/notifications");
    const { generateScotusVacancyNews } = await import("@/lib/scotus/scotusNews");
    const result = await processScotusTenureTurn(
      100 + DIVERGENT_TENURE_FLOOR_TURNS + 50,
      db as unknown as Db
    );

    expect(result.seatsVacatedByHazard).toBe(1);
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).toHaveBeenCalledWith(
      { _id: seatId, justiceMode: "character" },
      expect.objectContaining({
        $set: expect.objectContaining({ justiceCharacterId: null, justiceMode: null }),
      })
    );
    expect(generateScotusVacancyNews).toHaveBeenCalledWith({
      seatNumber: 1,
      justiceName: "Lyndon B. Johnson",
      cause: "death",
    });
    expect(createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: occupantUserId,
        type: "system",
        title: "Died in office",
        message: expect.stringContaining("You died while serving as a Justice"),
      }),
    ]);
  });

  it("does not replay Original Roster succession over a player-held non-divergent seat", async () => {
    const seatId = new ObjectId();
    const playerId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 1,
      isDivergent: false,
      justiceCharacterId: playerId,
      historicalOccupantIndex: 0,
      historicalOccupants: [
        {
          key: "a",
          name: "Justice A",
          economicLean: 2,
          socialLean: 2,
          seatedYear: 1953,
          departureYear: 1954,
          departureReason: "death",
        },
        {
          key: "b",
          name: "Justice B",
          economicLean: -2,
          socialLean: -2,
          seatedYear: 1954,
          departureYear: null,
          departureReason: null,
        },
      ],
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const result = await processScotusTenureTurn(49, db as unknown as Db);

    expect(result).toEqual({ seatsAdvanced: 0, seatsVacatedByHistory: 0, seatsVacatedByHazard: 0 });
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).not.toHaveBeenCalled();
  });

  it("notifies the president and posts vacancy news when an NPP divergent justice departs", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.0001);
    const seatId = new ObjectId();
    const presidentCharId = new ObjectId();
    const presidentUserId = new ObjectId();
    const seat = {
      _id: seatId,
      countryId: "US",
      seatNumber: 6,
      isDivergent: true,
      historicalOccupants: [],
      justiceMode: "npp",
      justiceCharacterId: null,
      justiceNppId: new ObjectId(),
      justiceName: "NPP Scholar",
      seatedAtTurn: 100,
      divergentHazardStartsTurn: 100 + DIVERGENT_TENURE_FLOOR_TURNS,
    };
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat]),
    });
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({
      countryId: "US",
      officeType: "president",
      characterId: presidentCharId,
    });
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: presidentCharId,
      userId: presidentUserId,
    });

    const { processScotusTenureTurn } = await import("./scotusTenureTurn");
    const { createNotifications } = await import("@/lib/notifications");
    const { generateScotusVacancyNews } = await import("@/lib/scotus/scotusNews");

    await processScotusTenureTurn(100 + DIVERGENT_TENURE_FLOOR_TURNS, db as unknown as Db);

    expect(generateScotusVacancyNews).toHaveBeenCalledWith({
      seatNumber: 6,
      justiceName: "NPP Scholar",
      cause: "death",
    });
    expect(createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: presidentUserId,
        type: "system",
        title: "Supreme Court vacancy",
        message: expect.stringContaining("has died in office"),
      }),
    ]);
  });
});
