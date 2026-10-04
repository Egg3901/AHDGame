import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

const declareWar = vi.fn();
const joinManyToSide = vi.fn();
const loadMilitaryBlocs = vi.fn();
const sideOf = vi.fn();

vi.mock("@/lib/military/declareWar", () => ({
  declareWar: (...args: unknown[]) => declareWar(...args),
}));
vi.mock("@/lib/military/joinSide", () => ({
  joinManyToSide: (...args: unknown[]) => joinManyToSide(...args),
}));
vi.mock("@/lib/military/blocLookup", () => ({
  loadMilitaryBlocs: (...args: unknown[]) => loadMilitaryBlocs(...args),
}));
vi.mock("@/lib/military/occupation", () => ({
  sideOf: (...args: unknown[]) => sideOf(...args),
}));

import { enactAutomaticOrganizationWar } from "./enactAutomaticWarDeclaration";

describe("enactAutomaticOrganizationWar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    declareWar.mockResolvedValue({ conflict: { _id: "conflict-1" } });
    loadMilitaryBlocs.mockResolvedValue({});
    sideOf.mockReturnValue("B");
    joinManyToSide.mockResolvedValue(undefined);
  });

  it("starts one war and joins every other NPP declarer to the same side", async () => {
    const db = {} as Db;

    const result = await enactAutomaticOrganizationWar({
      db,
      declarers: ["FR", "DE", "FR"],
      defender: "CN",
      warGoal: "punitive",
      resolutionId: "resolution-1",
      currentTurn: 211,
    });

    expect(declareWar).toHaveBeenCalledWith(db, {
      declarer: "DE",
      defender: "CN",
      warGoal: "punitive",
      billId: "organization:resolution-1",
      currentTurn: 211,
    });
    expect(joinManyToSide).toHaveBeenCalledWith(db, { _id: "conflict-1" }, ["FR"], "A", 211);
    expect(result).toBe("conflict-1");
  });

  it("does nothing when there are no automatic participants", async () => {
    const result = await enactAutomaticOrganizationWar({
      db: {} as Db,
      declarers: [],
      defender: "CN",
      warGoal: "punitive",
      resolutionId: "resolution-1",
      currentTurn: 211,
    });

    expect(result).toBeNull();
    expect(declareWar).not.toHaveBeenCalled();
  });
});
