import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 410 }),
}));
vi.mock("@/lib/cabinet/liveGameYear", () => ({
  getLiveGameYear: vi.fn().mockResolvedValue(1953),
  getManuallyEnabledSeats: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/cabinet/rosterEra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cabinet/rosterEra")>()),
  resolveCabinetRoster: () => [
    { id: "secretary_of_treasury", name: "Secretary of the Treasury", order: 2 },
  ],
}));
vi.mock("@/lib/db/characterLookup", () => ({
  bulkFetchCharacterNames: vi.fn().mockResolvedValue(new Map()),
}));

let db: MockDb;

function seatMember(member: Record<string, unknown>) {
  db.collectionMocks["cabinetMembers"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([member]),
  });
}

function emptyCursor() {
  return { toArray: vi.fn().mockResolvedValue([]), sort: vi.fn().mockReturnThis() };
}

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  for (const name of [
    "cabinetMembers",
    "cabinetNominations",
    "electedOfficials",
    "characters",
    "politicalParties",
    "actingAppointmentCharges",
  ]) {
    db.collection(name);
  }
  db.collectionMocks["cabinetNominations"]!.find.mockReturnValue(emptyCursor());
  db.collectionMocks["politicalParties"]!.find.mockReturnValue(emptyCursor());
  db.collectionMocks["actingAppointmentCharges"]!.find.mockReturnValue(emptyCursor());
  db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
});

async function get() {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/whitehouse/cabinet?country=US"));
}

describe("GET /api/whitehouse/cabinet acting reporting", () => {
  it("reports a genuine acting holder as acting, with the turn it lapses", async () => {
    seatMember({
      _id: new ObjectId(),
      countryId: "US",
      positionId: "secretary_of_treasury",
      characterId: new ObjectId(),
      characterName: "A. Caretaker",
      acting: true,
      actingExpiresOnTurn: 424,
      createdAt: new Date(0),
    });

    const body = await (await get()).json();
    const position = body.positions.find((p: { id: string }) => p.id === "secretary_of_treasury");
    expect(position.member.acting).toBe(true);
    expect(position.member.actingExpiresOnTurn).toBe(424);
  });

  it("does not report a seat held by a non player party as acting", async () => {
    // Regression: this used to be computed as `isNPP ? true : false`, which
    // both hid real acting holders and mislabelled NPP-held seats.
    seatMember({
      _id: new ObjectId(),
      countryId: "US",
      positionId: "secretary_of_treasury",
      characterId: null,
      characterName: "Caretaker Party Minister",
      isNPP: true,
      nppId: new ObjectId(),
      createdAt: new Date(0),
    });

    const body = await (await get()).json();
    const position = body.positions.find((p: { id: string }) => p.id === "secretary_of_treasury");
    expect(position.member.acting).toBe(false);
    expect(position.member.isNPP).toBe(true);
  });

  it("reports a confirmed holder as not acting", async () => {
    seatMember({
      _id: new ObjectId(),
      countryId: "US",
      positionId: "secretary_of_treasury",
      characterId: new ObjectId(),
      characterName: "M. Ruiz",
      confirmedAt: new Date(0),
      createdAt: new Date(0),
    });

    const body = await (await get()).json();
    const position = body.positions.find((p: { id: string }) => p.id === "secretary_of_treasury");
    expect(position.member.acting).toBe(false);
    expect(position.member.actingExpiresOnTurn).toBeNull();
  });
});
