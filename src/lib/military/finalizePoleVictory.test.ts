import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const standDownCountry = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/military/leaveConflict", () => ({
  standDownCountry: (...args: unknown[]) => standDownCountry(...args),
}));
const resolveConflict = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/military/resolveConflict", () => ({
  resolveConflict: (...args: unknown[]) => resolveConflict(...args),
}));

const { finalizePoleVictory } = await import("./finalizePoleVictory");

const conflict = (over: Partial<ConflictDoc> = {}): ConflictDoc =>
  ({
    _id: "war_ru_de_100",
    type: "interstate",
    status: "active",
    control: 100,
    poleSide: "B",
    poleSinceTurn: 120,
    sideA: { label: "Soviet Union", countries: ["RU"], kind: "state" },
    sideB: { label: "West Germany", countries: ["DE"], kind: "state" },
    ...over,
  }) as ConflictDoc;

describe("finalizePoleVictory", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("conflicts");
    db.collectionMocks.conflicts.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("atomically opens a terms window and stands down both sides", async () => {
    const result = await finalizePoleVictory(db as unknown as Db, conflict(), "B", 124);

    expect(result).toBe("terms_pending");
    const [filter, update] = db.collectionMocks.conflicts.updateOne.mock.calls[0];
    expect(filter).toMatchObject({ control: 100, poleSide: "B" });
    expect(update.$set).toMatchObject({
      status: "terms_pending",
      termsWindow: { victor: "B", imposer: "DE", target: "RU" },
    });
    expect(standDownCountry).toHaveBeenCalledTimes(2);
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it("resolves outright when the losing side has no principal", async () => {
    const noTarget = conflict({
      sideA: { label: "Generated force", countries: [], kind: "generated" },
    });
    const result = await finalizePoleVictory(db as unknown as Db, noTarget, "B", 124);

    expect(result).toBe("resolved");
    expect(resolveConflict).toHaveBeenCalledWith(expect.anything(), noTarget, "B", 124);
    expect(standDownCountry).not.toHaveBeenCalled();
  });

  it("does nothing when another turn runner wins the claim", async () => {
    db.collectionMocks.conflicts.updateOne.mockResolvedValue({ modifiedCount: 0 });
    const result = await finalizePoleVictory(db as unknown as Db, conflict(), "B", 124);

    expect(result).toBeNull();
    expect(standDownCountry).not.toHaveBeenCalled();
    expect(resolveConflict).not.toHaveBeenCalled();
  });
});
