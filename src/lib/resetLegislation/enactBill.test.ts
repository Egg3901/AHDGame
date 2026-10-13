import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ResetLawProvision } from "@/lib/db/types/legislation";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { buildOpeningLawBoards1991 } from "./openingBoards1991";
import { resetLawFamilyById } from "./catalog";
import profiles from "./provisionalBalanceProfiles.json";
import { buildReviewedOptionCatalog } from "./rules/reviewCatalog";
import { buildOpeningDepartmentBoards1991 } from "@/lib/resetFinance/openingDepartmentBoards1991";
import { openingFiscalBooks1991 } from "@/lib/resetFinance/opening1991";
import { openingNamedGrantClaims1991 } from "@/lib/resetFinance/openingOwnership1991";
import { buildOpeningDepartmentFundingPartition } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";

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

  it("adds every national law allocation change to total federal spending", async () => {
    const worldId = "world-national-budget";
    const board = buildOpeningLawBoards1991(worldId, 1).find(
      (candidate) => candidate._id === "US:national"
    )!;
    const family = resetLawFamilyById("L01")!;
    const reference = board.references[family.id]!;
    const profile = profiles.find((candidate) => candidate.familyId === family.id)!;
    const fiscal = openingFiscalBooks1991();
    const partition = buildOpeningDepartmentFundingPartition(
      buildOpeningDepartmentBoards1991(worldId, 1),
      DEPARTMENT_DEFINITIONS,
      {
        US: fiscal.US.grants,
        UK: fiscal.UK.grants,
        JP: fiscal.JP.grants,
        IE: fiscal.IE.grants,
      },
      openingNamedGrantClaims1991()
    );
    const account = partition.accounts.find(
      (candidate) => candidate.countryId === "US" && candidate.familyAnnualDemand.L01 !== undefined
    )!;
    const options = buildReviewedOptionCatalog({
      family,
      reference,
      profile,
      country: "US",
      scope: "national",
      year: 1991,
      jurisdictionGdp: fiscal.US.gdp,
      fundingAccountId: account._id,
      legalAuthorityId: "US:national:L01",
      serviceDelivererId: account.departmentId,
    });
    const selected = options.find((entry) => entry.option.choice !== entry.currentChoice)!;
    expect(selected.annualAllocationDelta).not.toBe(0);
    const provision: ResetLawProvision = {
      type: "reset_law",
      familyId: family.id,
      scope: "national",
      choice: selected.option.choice,
      reviewedOption: selected.option,
      titleSnapshot: selected.title,
      descriptionSnapshot: selected.description,
      currentLawSnapshot: reference.currentLaw,
      currentLawDescriptionSnapshot: reference.legalNote,
      currentChoiceSnapshot: selected.currentChoice,
      currentAnnualAllocationSnapshot: selected.currentAnnualAllocation,
      annualAllocationDeltaSnapshot: selected.annualAllocationDelta,
      overseeingSeatIdSnapshot: account.controllingSeatId,
      overseeingAgencyIdSnapshot: account.departmentId,
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
    for (const name of ["resetDepartmentAccounts", "federalBudget"]) db.collection(name);
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
    db.collectionMocks.resetDepartmentAccounts!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(partition.accounts.filter((candidate) => candidate.countryId === "US")),
    });
    const bill = {
      _id: new ObjectId(),
      countryId: "US" as const,
      provisions: [provision],
    };

    await applyResetLawBillEnactment(db as unknown as Db, bill, 2);

    expect(db.collectionMocks.federalBudget!.updateOne).toHaveBeenCalledWith(
      { countryId: "US" },
      { $inc: { "spending.total": selected.annualAllocationDelta } },
      expect.anything()
    );
  });
});

describe("applyResetLawBillEnactment stranded family demand", () => {
  async function enactL10(input: {
    choice: "leave_to_states" | "keep";
    existingAllocation: number;
    stranded: number;
    moveFunder?: boolean;
  }) {
    vi.clearAllMocks();
    const db = createMockDb();
    for (const name of [
      "resetLawEnactmentReceipts",
      "gameState",
      "resetLawOpeningBoards",
      "resetLawPrograms",
      "resetDepartmentAccounts",
      "federalBudget",
    ])
      db.collection(name);
    const worldId = "world-stranded";
    const board = buildOpeningLawBoards1991(worldId, 1).find(
      (candidate) => candidate._id === "US:national"
    )!;
    const family = resetLawFamilyById("L10")!;
    const reference = board.references[family.id]!;
    const profile = profiles.find((candidate) => candidate.familyId === family.id)!;
    const fiscal = openingFiscalBooks1991();
    const partition = buildOpeningDepartmentFundingPartition(
      buildOpeningDepartmentBoards1991(worldId, 1),
      DEPARTMENT_DEFINITIONS,
      { US: fiscal.US.grants, UK: fiscal.UK.grants, JP: fiscal.JP.grants, IE: fiscal.IE.grants },
      openingNamedGrantClaims1991()
    );
    const accounts = structuredClone(
      partition.accounts.filter((candidate) => candidate.countryId === "US")
    );
    const owner = accounts.find((candidate) => candidate.familyAnnualDemand.L10 !== undefined)!;
    const other = accounts.find(
      (candidate) => candidate._id !== owner._id && !candidate.externallySettled
    )!;
    const booked = input.existingAllocation + input.stranded;
    owner.annualAuthority += booked - owner.familyAnnualDemand.L10!;
    owner.grossAnnualClaim += booked - owner.familyAnnualDemand.L10!;
    owner.familyAnnualDemand.L10 = booked;
    const funder = input.moveFunder ? other._id : owner._id;
    const options = buildReviewedOptionCatalog({
      family,
      reference,
      profile,
      country: "US",
      scope: "national",
      year: 1991,
      jurisdictionGdp: fiscal.US.gdp,
      fundingAccountId: funder,
      legalAuthorityId: "US:national:L10",
      serviceDelivererId: owner.departmentId,
      current: {
        country: "US",
        scope: "national",
        familyId: "L10",
        choice: "center",
        annualAgencyAllocation: input.existingAllocation,
        supersededSourceIds: reference.sourceComponents.map((source) => source.sourceId),
      },
    } as Parameters<typeof buildReviewedOptionCatalog>[0]);
    const selected =
      input.choice === "leave_to_states"
        ? options.find((entry) => entry.option.choice === "leave_to_states")!
        : options.find((entry) => entry.option.choice !== "leave_to_states")!;
    const provision: ResetLawProvision = {
      type: "reset_law",
      familyId: family.id,
      scope: "national",
      choice: selected.option.choice,
      reviewedOption: selected.option,
      titleSnapshot: selected.title,
      descriptionSnapshot: selected.description,
      currentLawSnapshot: reference.currentLaw,
      currentLawDescriptionSnapshot: reference.legalNote,
      currentChoiceSnapshot: selected.currentChoice,
      currentAnnualAllocationSnapshot: selected.currentAnnualAllocation,
      annualAllocationDeltaSnapshot: selected.annualAllocationDelta,
      overseeingSeatIdSnapshot: owner.controllingSeatId,
      overseeingAgencyIdSnapshot: owner.departmentId,
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
      toArray: vi.fn().mockResolvedValue([
        {
          _id: `${worldId}:US:national:L10`,
          worldId,
          country: "US",
          scope: "national",
          familyId: "L10",
          choice: "center",
          effectiveTurn: 100,
          legalAuthorityId: "US:national:L10",
          serviceDelivererId: owner.departmentId,
          fundingAccountId: owner._id,
          annualAgencyAllocation: input.existingAllocation,
          supersededSourceIds: reference.sourceComponents.map((source) => source.sourceId),
        },
      ]),
    });
    db.collectionMocks.resetDepartmentAccounts!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(accounts),
    });
    await applyResetLawBillEnactment(
      db as unknown as Db,
      { _id: new ObjectId(), countryId: "US" as const, provisions: [provision] },
      127
    );
    const writes = new Map<string, Record<string, number>>(
      db.collectionMocks.resetDepartmentAccounts!.updateOne.mock.calls.map((call) => [
        (call[0] as { _id: string })._id,
        (call[1] as { $set: { familyAnnualDemand: Record<string, number> } }).$set
          .familyAnnualDemand,
      ])
    );
    const spending = db.collectionMocks.federalBudget!.updateOne.mock.calls[0]?.[1] as
      { $inc: Record<string, number> } | undefined;
    return { owner, other, selected, writes, spending };
  }

  it("ends every national L10 authority when the program is left to the states", async () => {
    const { owner, selected, writes, spending } = await enactL10({
      choice: "leave_to_states",
      existingAllocation: 1_000_000,
      stranded: 37,
    });
    expect(writes.get(owner._id)!.L10).toBe(0);
    expect(spending!.$inc["spending.total"]).toBe(selected.option.annualAllocation - 1_000_037);
  });

  it("moves leftover demand to the new funder instead of stranding it", async () => {
    const { owner, other, selected, writes, spending } = await enactL10({
      choice: "keep",
      existingAllocation: 1_000_000,
      stranded: 37,
      moveFunder: true,
    });
    expect(writes.get(owner._id)!.L10).toBe(0);
    expect(writes.get(other._id)!.L10).toBe(selected.option.annualAllocation + 37);
    expect(spending!.$inc["spending.total"]).toBe(selected.option.annualAllocation - 1_000_000);
  });

  it("keeps an unchanged funder's existing demand arithmetic", async () => {
    const { owner, selected, writes } = await enactL10({
      choice: "keep",
      existingAllocation: 1_000_000,
      stranded: 37,
    });
    expect(writes.get(owner._id)!.L10).toBe(selected.option.annualAllocation + 37);
  });
});
