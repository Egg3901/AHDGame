import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/headOfGovernment", () => ({ getHeadOfGovernmentCharacterId: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

/** Point a mocked `find()` at a fixed result set. */
function primeFind(db: MockDb, name: string, docs: unknown[]) {
  prime(db, name).find.mockReturnValue({ toArray: vi.fn().mockResolvedValue(docs) });
}

describe("resolveSeatOffices", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getHeadOfGovernmentCharacterId } = await import("@/lib/api/headOfGovernment");
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(null);
    primeFind(db, "characters", []);
    primeFind(db, "cabinetMembers", []);
  });

  it("names the head of government holding a seat", async () => {
    const president = new ObjectId();
    const { getHeadOfGovernmentCharacterId } = await import("@/lib/api/headOfGovernment");
    vi.mocked(getHeadOfGovernmentCharacterId).mockImplementation(async (_db, countryId) =>
      countryId === "US" ? president : null
    );
    primeFind(db, "characters", [{ _id: president, name: "Ariane Yeong" }]);

    const { resolveSeatOffices } = await import("./seatOffices");
    const offices = await resolveSeatOffices(db as unknown as Db);

    expect(offices.US[0]).toEqual({
      role: "headOfGovernment",
      title: "President",
      holder: "Ariane Yeong",
    });
  });

  it("names the foreign minister holding a seat", async () => {
    primeFind(db, "cabinetMembers", [
      {
        countryId: "UK",
        positionId: "foreign_secretary",
        characterId: new ObjectId(),
        characterName: "Takashi Ito",
      },
    ]);

    const { resolveSeatOffices } = await import("./seatOffices");
    const offices = await resolveSeatOffices(db as unknown as Db);

    expect(offices.UK[1]).toEqual({
      role: "foreignMinister",
      title: "Foreign Secretary",
      holder: "Takashi Ito",
    });
  });

  it("names the defence minister holding a seat", async () => {
    primeFind(db, "cabinetMembers", [
      {
        countryId: "DD",
        positionId: "minister_of_defence",
        characterId: new ObjectId(),
        characterName: "Erich Keller",
      },
    ]);

    const { resolveSeatOffices } = await import("./seatOffices");
    const offices = await resolveSeatOffices(db as unknown as Db);

    expect(offices.DD[2]).toEqual({
      role: "defenseMinister",
      title: "Minister of National Defence",
      holder: "Erich Keller",
    });
  });

  it("titles each head of government from its own country config", async () => {
    const { resolveSeatOffices } = await import("./seatOffices");
    const offices = await resolveSeatOffices(db as unknown as Db);

    // Not "President" across the board: a one-party state's executive is its
    // General Secretary or Premier, and the seat block has to say so.
    expect(offices.US[0].title).toBe("President");
    expect(offices.UK[0].title).toBe("Prime Minister");
    expect(offices.RU[0].title).toBe("Premier");
    expect(offices.DD[0].title).toBe("General Secretary");
  });

  it("titles each foreign minister from its own cabinet roster", async () => {
    const { resolveSeatOffices } = await import("./seatOffices");
    const offices = await resolveSeatOffices(db as unknown as Db);

    expect(offices.US[1].title).toBe("Secretary of State");
    expect(offices.UK[1].title).toBe("Foreign Secretary");
    expect(offices.RU[1].title).toBe("Minister of Foreign Affairs");
    expect(offices.DD[1].title).toBe("Minister of Foreign Affairs");
  });

  it("titles each defence minister from its own cabinet roster", async () => {
    const { resolveSeatOffices } = await import("./seatOffices");
    const offices = await resolveSeatOffices(db as unknown as Db);

    expect(offices.US[2].title).toBe("Secretary of Defense");
    expect(offices.UK[2].title).toBe("Secretary of State for Defence");
    expect(offices.RU[2].title).toBe("Minister of Defence");
    expect(offices.DD[2].title).toBe("Minister of National Defence");
  });

  it("returns both offices for every seat even when neither is held", async () => {
    const { resolveSeatOffices } = await import("./seatOffices");
    const offices = await resolveSeatOffices(db as unknown as Db);

    for (const seatId of ["US", "UK", "RU", "DD"] as const) {
      expect(offices[seatId]).toHaveLength(3);
      expect(offices[seatId].map((o) => o.role)).toEqual([
        "headOfGovernment",
        "foreignMinister",
        "defenseMinister",
      ]);
      expect(offices[seatId].every((o) => o.holder === null)).toBe(true);
    }
  });

  it("reports a vacant or NPP-held cabinet seat as unheld", async () => {
    // Both carry a null characterId. `seatResolution` refuses a claim on
    // exactly that test, so the panel must not print a name here either — it
    // would name someone who cannot actually play.
    primeFind(db, "cabinetMembers", [
      {
        countryId: "DD",
        positionId: "minister_of_foreign_affairs",
        characterId: null,
        characterName: "Some NPP Minister",
      },
    ]);

    const { resolveSeatOffices } = await import("./seatOffices");
    const offices = await resolveSeatOffices(db as unknown as Db);

    expect(offices.DD[1].holder).toBeNull();
  });

  it("reports an unheld head of government as unheld", async () => {
    const ghost = new ObjectId();
    const { getHeadOfGovernmentCharacterId } = await import("@/lib/api/headOfGovernment");
    vi.mocked(getHeadOfGovernmentCharacterId).mockImplementation(async (_db, countryId) =>
      countryId === "RU" ? ghost : null
    );
    // The seat names a character the characters collection no longer has.
    primeFind(db, "characters", []);

    const { resolveSeatOffices } = await import("./seatOffices");
    const offices = await resolveSeatOffices(db as unknown as Db);

    expect(offices.RU[0].holder).toBeNull();
  });

  it("scopes the cabinet query to the four seat countries and their own position ids", async () => {
    const cabinet = prime(db, "cabinetMembers");
    const { resolveSeatOffices } = await import("./seatOffices");
    await resolveSeatOffices(db as unknown as Db);

    const filter = cabinet.find.mock.calls[0][0];
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        { countryId: "US", positionId: "secretary_of_state" },
        { countryId: "UK", positionId: "foreign_secretary" },
        { countryId: "RU", positionId: "minister_of_foreign_affairs" },
        { countryId: "DD", positionId: "minister_of_foreign_affairs" },
        { countryId: "US", positionId: "secretary_of_defense" },
        { countryId: "UK", positionId: "defence_secretary" },
        { countryId: "RU", positionId: "minister_of_defence" },
        { countryId: "DD", positionId: "minister_of_defence" },
      ])
    );
    expect(filter.$or).toHaveLength(8);
  });

  it("pairs country to position rather than crossing the two lists", async () => {
    // RU and DD share `minister_of_foreign_affairs`, so an `$in` on each field
    // would also match pairings that do not exist, e.g. US + that id.
    const cabinet = prime(db, "cabinetMembers");
    const { resolveSeatOffices } = await import("./seatOffices");
    await resolveSeatOffices(db as unknown as Db);

    const filter = cabinet.find.mock.calls[0][0];
    expect(filter.$or).not.toContainEqual({
      countryId: "US",
      positionId: "minister_of_foreign_affairs",
    });
  });

  it("looks every holder name up in a single query", async () => {
    const heads = {
      US: new ObjectId(),
      UK: new ObjectId(),
      RU: new ObjectId(),
      DD: new ObjectId(),
    };
    const { getHeadOfGovernmentCharacterId } = await import("@/lib/api/headOfGovernment");
    vi.mocked(getHeadOfGovernmentCharacterId).mockImplementation(
      async (_db, countryId) => heads[countryId as keyof typeof heads] ?? null
    );
    const characters = prime(db, "characters");
    characters.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    const { resolveSeatOffices } = await import("./seatOffices");
    await resolveSeatOffices(db as unknown as Db);

    expect(characters.find).toHaveBeenCalledTimes(1);
    expect(prime(db, "cabinetMembers").find).toHaveBeenCalledTimes(1);
  });

  it("does not query characters at all when no seat has a head of government", async () => {
    const characters = prime(db, "characters");
    const { resolveSeatOffices } = await import("./seatOffices");
    await resolveSeatOffices(db as unknown as Db);

    expect(characters.find).not.toHaveBeenCalled();
  });
});
