import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ResetLawProvision } from "@/lib/db/types/legislation";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { buildOpeningLawBoards1991 } from "./openingBoards1991";
import { resetLawFamilyById } from "./catalog";
import profiles from "./provisionalBalanceProfiles.json";
import { buildReviewedOptionCatalog } from "./rules/reviewCatalog";

vi.mock("@/lib/db/runRequiredTransaction", () => ({
  runRequiredTransaction: vi.fn((body: (session: Record<string, never>) => Promise<unknown>) =>
    body({})
  ),
}));

import { applyResetLawBillEnactment } from "./enactBill";

describe("applyResetLawBillEnactment", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "resetLawEnactmentReceipts",
      "gameState",
      "resetLawOpeningBoards",
      "resetLawPrograms",
    ]) {
      db.collection(name);
    }
  });

  it("persists a regional program and exactly-once enactment receipt", async () => {
    const worldId = "world-test";
    const board = buildOpeningLawBoards1991(worldId, 1).find(
      (candidate) => candidate._id === "US:PA"
    )!;
    const family = resetLawFamilyById("L19")!;
    const reference = board.references.L19!;
    const profile = profiles.find((candidate) => candidate.familyId === "L19")!;
    const options = buildReviewedOptionCatalog({
      family,
      reference,
      profile,
      country: "US",
      scope: "regional",
      year: 1991,
      jurisdictionGdp: 200_000_000_000,
      fundingAccountId: "regional_budget",
      legalAuthorityId: "US:regional:L19",
      serviceDelivererId: "US:PA:regional_services",
      levelText: Object.fromEntries(
        family.levels.map((level) => [
          level.position,
          { title: level.title, description: level.description },
        ])
      ),
    });
    const selected = options.find((entry) => entry.option.choice !== entry.currentChoice)!;
    const provision: ResetLawProvision = {
      type: "reset_law",
      familyId: family.id,
      scope: "regional",
      regionId: "PA",
      choice: selected.option.choice,
      reviewedOption: selected.option,
      titleSnapshot: selected.title,
      descriptionSnapshot: selected.description,
      currentLawSnapshot: reference.currentLaw,
      currentLawDescriptionSnapshot: reference.legalNote,
      currentChoiceSnapshot: selected.currentChoice,
      currentAnnualAllocationSnapshot: selected.currentAnnualAllocation,
      annualAllocationDeltaSnapshot: selected.annualAllocationDelta,
      overseeingSeatIdSnapshot: null,
      overseeingAgencyIdSnapshot: "regional_budget",
      primaryMetricEffectsSnapshot: [...selected.primaryMetricEffects],
      balanceBasis: selected.balanceBasis,
    };
    const receipt = {
      worldId,
      revision: RESET_V2_SEED_REVISION.metrics,
      sourceTurn: 1,
      completedAt: new Date(0).toISOString(),
      verificationHash: "metrics-hash",
    };
    db.collectionMocks.resetLawEnactmentReceipts!.findOne.mockResolvedValue(null);
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      resetWorldId: worldId,
      currentYear: 1991,
      metricsSystemVersion: "v2",
      legislationSystemVersion: "v2",
      resetVersionSeeds: {
        metrics: receipt,
        legislation: {
          ...receipt,
          revision: RESET_V2_SEED_REVISION.legislation,
          verificationHash: "legislation-hash",
        },
      },
    });
    db.collectionMocks.resetLawOpeningBoards!.findOne.mockResolvedValue(board);
    db.collectionMocks.resetLawPrograms!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const bill = {
      _id: new ObjectId(),
      countryId: "US" as const,
      stateId: "PA",
      provisions: [provision],
    };

    await expect(applyResetLawBillEnactment(db as unknown as Db, bill, 2)).resolves.toEqual({
      applied: true,
      programs: 1,
    });
    expect(db.collectionMocks.resetLawPrograms!.replaceOne).toHaveBeenCalledWith(
      { _id: `${worldId}:US:PA:L19`, worldId },
      expect.objectContaining({
        _id: `${worldId}:US:PA:L19`,
        regionId: "PA",
        familyId: "L19",
        annualAgencyAllocation: selected.option.annualAllocation,
      }),
      expect.objectContaining({ upsert: true })
    );
    expect(db.collectionMocks.resetLawEnactmentReceipts!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: bill._id.toString(),
        programIds: [`${worldId}:US:PA:L19`],
      }),
      expect.anything()
    );
  });
});
