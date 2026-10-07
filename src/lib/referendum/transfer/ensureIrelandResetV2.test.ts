import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { RESET_V2_SEED_REVISION, type ResetSystem } from "@/lib/resetVersions/rules";

vi.mock("@/lib/resetMetrics/seedOpening1991", () => ({ seedOpeningMetrics1991: vi.fn() }));
vi.mock("@/lib/resetLegislation/seedOpening1991", () => ({ seedOpeningLawBoards1991: vi.fn() }));
vi.mock("@/lib/resetFinance/seedOpeningDepartments1991", () => ({
  seedOpeningDepartmentBoards1991: vi.fn(),
}));

import { seedOpeningMetrics1991 } from "@/lib/resetMetrics/seedOpening1991";
import { seedOpeningLawBoards1991 } from "@/lib/resetLegislation/seedOpening1991";
import { seedOpeningDepartmentBoards1991 } from "@/lib/resetFinance/seedOpeningDepartments1991";
import { ensureIrelandResetV2ForReunification } from "@/lib/countries/ie/resetV2/ensureForReunification";

const systems = ["metrics", "legislation", "cabinet"] as const;

function receipt(system: ResetSystem, countries = ["US", "UK", "JP"]) {
  return {
    worldId: "world-a",
    revision: RESET_V2_SEED_REVISION[system],
    sourceTurn: 1,
    completedAt: "2026-10-04T00:00:00.000Z",
    verificationHash: `old-${system}`,
    countries,
  };
}

function gameState(countries = ["US", "UK", "JP"]) {
  return {
    _id: "current",
    resetWorldId: "world-a",
    currentTurn: 9,
    metricsSystemVersion: "v2",
    legislationSystemVersion: "v2",
    cabinetSystemVersion: "v2",
    resetVersionSeeds: Object.fromEntries(
      systems.map((system) => [system, receipt(system, countries)])
    ),
  };
}

describe("ensureIrelandResetV2ForReunification", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue(gameState());
    vi.mocked(seedOpeningMetrics1991).mockResolvedValue(receipt("metrics", ["IE"]));
    vi.mocked(seedOpeningLawBoards1991).mockResolvedValue(receipt("legislation", ["IE"]));
    vi.mocked(seedOpeningDepartmentBoards1991).mockResolvedValue(receipt("cabinet", ["IE"]));
  });

  it("seeds only Ireland and adds it to every active v2 receipt", async () => {
    await expect(ensureIrelandResetV2ForReunification(db as unknown as Db)).resolves.toEqual({
      promoted: true,
    });
    expect(seedOpeningMetrics1991).toHaveBeenCalledWith(db, "world-a", 9, ["IE"]);
    expect(seedOpeningLawBoards1991).toHaveBeenCalledWith(db, "world-a", 9, ["IE"]);
    expect(seedOpeningDepartmentBoards1991).toHaveBeenCalledWith(db, "world-a", 9, ["IE"]);
    const set = db.collection("gameState").updateOne.mock.calls[0][1].$set;
    for (const system of systems) {
      expect(set[`resetVersionSeeds.${system}`].sourceTurn).toBe(1);
      expect(set[`resetVersionSeeds.${system}`].countries).toEqual(["IE", "JP", "UK", "US"]);
    }
  });

  it("does nothing when Ireland is already covered by every active receipt", async () => {
    db.collection("gameState").findOne.mockResolvedValue(gameState(["US", "UK", "JP", "IE"]));
    await expect(ensureIrelandResetV2ForReunification(db as unknown as Db)).resolves.toEqual({
      promoted: false,
    });
    expect(seedOpeningMetrics1991).not.toHaveBeenCalled();
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
  });
});
