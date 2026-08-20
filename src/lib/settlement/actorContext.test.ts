import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import { SETTLEMENT_INSTITUTIONS, SETTLEMENT_SEATS } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./seatResolution", () => ({ resolveSettlementSeat: vi.fn() }));
vi.mock("./direction", () => ({ resolveSeatDirection: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const CRISIS_ID = new ObjectId();
const characterId = new ObjectId();

function crisisDoc() {
  return {
    _id: CRISIS_ID,
    status: "open",
    institutions: SETTLEMENT_INSTITUTIONS.map((i) => ({
      id: i.id,
      weight: i.weight,
      position: i.opening,
      lastPlay: null,
      lastDrift: 0,
    })),
    seats: SETTLEMENT_SEATS.map((s) => ({
      id: s.id,
      capital: 30,
      actionsUsedTurn: 0,
      lastActedTurn: null,
      committedPoints: 0,
    })),
  };
}

describe("loadSettlementActorContext", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "gameState").findOne.mockResolvedValue({
      _id: "current",
      settlementCrisisEnabled: true,
    });
    prime(db, "settlementCrises").findOne.mockResolvedValue(crisisDoc());
    prime(db, "characters").findOne.mockResolvedValue({ _id: characterId, actions: 4 });
    const { resolveSettlementSeat } = await import("./seatResolution");
    vi.mocked(resolveSettlementSeat).mockResolvedValue(null);
  });

  it("returns null when the feature gate is off", async () => {
    prime(db, "gameState").findOne.mockResolvedValue({
      _id: "current",
      settlementCrisisEnabled: false,
    });
    const { loadSettlementActorContext } = await import("./actorContext");
    await expect(loadSettlementActorContext(db as unknown as Db, characterId)).resolves.toBeNull();
  });

  it("gives an ordinary character personal actions and no seat", async () => {
    const { loadSettlementActorContext } = await import("./actorContext");
    const ctx = await loadSettlementActorContext(db as unknown as Db, characterId);
    expect(ctx?.seat).toBeNull();
    expect(ctx?.personal.actionsRemaining).toBe(4);
  });

  it("gives a seat holder both a seat and their own personal actions", async () => {
    const { resolveSettlementSeat } = await import("./seatResolution");
    vi.mocked(resolveSettlementSeat).mockResolvedValue({
      seatId: "DD",
      role: "headOfGovernment",
    });
    const { resolveSeatDirection } = await import("./direction");
    vi.mocked(resolveSeatDirection).mockResolvedValue(1);

    const { loadSettlementActorContext } = await import("./actorContext");
    const ctx = await loadSettlementActorContext(db as unknown as Db, characterId);
    expect(ctx?.seat).toMatchObject({
      id: "DD",
      role: "headOfGovernment",
      direction: 1,
      canAct: true,
      blockedReason: null,
    });
    expect(ctx?.seat?.budget).toEqual({
      actionsPerTurn: 3,
      actionsRemaining: 3,
      capital: 30,
    });
    // The switcher's whole premise: both budgets, independently.
    expect(ctx?.personal.actionsRemaining).toBe(4);
  });

  it("blocks a seat whose country is in neither bloc", async () => {
    const { resolveSettlementSeat } = await import("./seatResolution");
    vi.mocked(resolveSettlementSeat).mockResolvedValue({
      seatId: "UK",
      role: "foreignMinister",
    });
    const { resolveSeatDirection } = await import("./direction");
    vi.mocked(resolveSeatDirection).mockResolvedValue(null);

    const { loadSettlementActorContext } = await import("./actorContext");
    const ctx = await loadSettlementActorContext(db as unknown as Db, characterId);
    expect(ctx?.seat).toMatchObject({
      id: "UK",
      direction: null,
      canAct: false,
      blockedReason: "no-direction",
    });
    // Personal plays survive — a non-aligned nation's minister is still a person.
    expect(ctx?.personal.actionsRemaining).toBe(4);
  });

  it("blocks a seat that has spent its action allowance", async () => {
    const spent = crisisDoc();
    spent.seats = spent.seats.map((s) => (s.id === "US" ? { ...s, actionsUsedTurn: 1 } : s));
    prime(db, "settlementCrises").findOne.mockResolvedValue(spent);
    const { resolveSettlementSeat } = await import("./seatResolution");
    vi.mocked(resolveSettlementSeat).mockResolvedValue({
      seatId: "US",
      role: "headOfGovernment",
    });
    const { resolveSeatDirection } = await import("./direction");
    vi.mocked(resolveSeatDirection).mockResolvedValue(-1);

    const { loadSettlementActorContext } = await import("./actorContext");
    const ctx = await loadSettlementActorContext(db as unknown as Db, characterId);
    expect(ctx?.seat).toMatchObject({ canAct: false, blockedReason: "actions" });
  });

  it("reports no-direction ahead of an exhausted allowance", async () => {
    const spent = crisisDoc();
    spent.seats = spent.seats.map((s) => (s.id === "UK" ? { ...s, actionsUsedTurn: 5 } : s));
    prime(db, "settlementCrises").findOne.mockResolvedValue(spent);
    const { resolveSettlementSeat } = await import("./seatResolution");
    vi.mocked(resolveSettlementSeat).mockResolvedValue({
      seatId: "UK",
      role: "headOfGovernment",
    });
    const { resolveSeatDirection } = await import("./direction");
    vi.mocked(resolveSeatDirection).mockResolvedValue(null);

    const { loadSettlementActorContext } = await import("./actorContext");
    const ctx = await loadSettlementActorContext(db as unknown as Db, characterId);
    expect(ctx?.seat?.blockedReason).toBe("no-direction");
  });

  it("returns a context with no crisis id when none is open", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(null);
    const { loadSettlementActorContext } = await import("./actorContext");
    const ctx = await loadSettlementActorContext(db as unknown as Db, characterId);
    expect(ctx?.crisisId).toBeNull();
    expect(ctx?.seat).toBeNull();
    expect(ctx?.personal.actionsRemaining).toBe(4);
  });

  it("treats a character with no actions field as having none", async () => {
    prime(db, "characters").findOne.mockResolvedValue({ _id: characterId });
    const { loadSettlementActorContext } = await import("./actorContext");
    const ctx = await loadSettlementActorContext(db as unknown as Db, characterId);
    expect(ctx?.personal.actionsRemaining).toBe(0);
  });

  it("falls back to a zero budget when the crisis has no row for the claimed seat", async () => {
    const missing = crisisDoc();
    missing.seats = missing.seats.filter((s) => s.id !== "RU");
    prime(db, "settlementCrises").findOne.mockResolvedValue(missing);
    const { resolveSettlementSeat } = await import("./seatResolution");
    vi.mocked(resolveSettlementSeat).mockResolvedValue({
      seatId: "RU",
      role: "headOfGovernment",
    });
    const { resolveSeatDirection } = await import("./direction");
    vi.mocked(resolveSeatDirection).mockResolvedValue(1);

    const { loadSettlementActorContext } = await import("./actorContext");
    const ctx = await loadSettlementActorContext(db as unknown as Db, characterId);
    expect(ctx?.seat?.budget).toEqual({
      actionsPerTurn: 0,
      actionsRemaining: 0,
      capital: 0,
    });
    expect(ctx?.seat?.canAct).toBe(false);
  });
});
