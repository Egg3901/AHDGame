import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/cabinetTransition", () => ({
  notifyAndRestoreClearedHolders: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

let db: MockDb;

function lapsed(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "US",
    positionId: "secretary_of_treasury",
    characterId: new ObjectId(),
    acting: true,
    actingExpiresOnTurn: 424,
    ...overrides,
  };
}

function findReturns(rows: unknown[]) {
  db.collectionMocks["cabinetMembers"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(rows),
  });
}

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("cabinetMembers");
  db.collection("characters");
  db.collectionMocks["characters"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
});

describe("expireLapsedActingAppointments", () => {
  it("clears an acting holder whose tenure has run out", async () => {
    const row = lapsed();
    findReturns([row]);

    const { expireLapsedActingAppointments } = await import("./actingExpiry");
    const result = await expireLapsedActingAppointments(db as never, 424);

    expect(result.expired).toBe(1);
    expect(db.collectionMocks["cabinetMembers"]!.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [row._id] },
    });
  });

  it("restores the cleared holder's office so the action bonus stops", async () => {
    const row = lapsed();
    findReturns([row]);

    const { expireLapsedActingAppointments } = await import("./actingExpiry");
    await expireLapsedActingAppointments(db as never, 430);

    const { notifyAndRestoreClearedHolders } = await import("@/lib/cabinetTransition");
    expect(notifyAndRestoreClearedHolders).toHaveBeenCalledWith(db, "US", [row.characterId]);
  });

  it("leaves an acting holder still inside their tenure alone", async () => {
    findReturns([]);
    const { expireLapsedActingAppointments } = await import("./actingExpiry");
    const result = await expireLapsedActingAppointments(db as never, 400);
    expect(result.expired).toBe(0);
    expect(db.collectionMocks["cabinetMembers"]!.deleteMany).not.toHaveBeenCalled();
  });

  it("queries only acting members at or past their expiry turn", async () => {
    findReturns([]);
    const { expireLapsedActingAppointments } = await import("./actingExpiry");
    await expireLapsedActingAppointments(db as never, 424);
    expect(db.collectionMocks["cabinetMembers"]!.find).toHaveBeenCalledWith({
      acting: true,
      actingExpiresOnTurn: { $lte: 424 },
    });
  });

  it("ignores a lapsed row in a country that does not run acting appointments", async () => {
    findReturns([lapsed({ countryId: "UK" })]);
    const { expireLapsedActingAppointments } = await import("./actingExpiry");
    const result = await expireLapsedActingAppointments(db as never, 424);
    expect(result.expired).toBe(0);
    expect(db.collectionMocks["cabinetMembers"]!.deleteMany).not.toHaveBeenCalled();
  });

  it("notifies the lapsed holder by user id", async () => {
    const row = lapsed();
    const userId = new ObjectId();
    findReturns([row]);
    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: row.characterId, userId }]),
    });

    const { expireLapsedActingAppointments } = await import("./actingExpiry");
    await expireLapsedActingAppointments(db as never, 424);

    const { createNotifications } = await import("@/lib/notifications");
    expect(createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ userId, type: "system" }),
    ]);
  });
});
