import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { buildOpeningDepartmentBoards1991 } from "@/lib/resetFinance/openingDepartmentBoards1991";
import { openingFiscalBooks1991 } from "@/lib/resetFinance/opening1991";
import { openingNamedGrantClaims1991 } from "@/lib/resetFinance/openingOwnership1991";
import { buildOpeningDepartmentFundingPartition } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { buildOpeningLawBoards1991 } from "./openingBoards1991";
import { resetLawFamilyById } from "./catalog";
import profiles from "./provisionalBalanceProfiles.json";
import { buildReviewedOptionCatalog } from "./rules/reviewCatalog";
import { loadReviewedLawCatalog } from "./loadReviewedCatalog";

describe("loadReviewedLawCatalog", () => {
  it("presents the enacted program as current law and rebases proposal deltas on it", async () => {
    const worldId = "live-catalog-world";
    const fiscal = openingFiscalBooks1991();
    const board = buildOpeningLawBoards1991(worldId, 1).find(
      (candidate) => candidate._id === "US:national"
    )!;
    const partition = buildOpeningDepartmentFundingPartition(
      buildOpeningDepartmentBoards1991(worldId, 1),
      DEPARTMENT_DEFINITIONS,
      { US: fiscal.US.grants, UK: fiscal.UK.grants, JP: fiscal.JP.grants },
      openingNamedGrantClaims1991()
    );
    const account = partition.accounts.find(
      (candidate) => candidate.countryId === "US" && candidate.familyAnnualDemand.L01 !== undefined
    )!;
    const family = resetLawFamilyById("L01")!;
    const reference = board.references.L01!;
    const profile = profiles.find((candidate) => candidate.familyId === "L01")!;
    const enacted = buildReviewedOptionCatalog({
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
    }).find((entry) => entry.option.choice === "far_left")!;
    const db = createMockDb();
    for (const name of [
      "resetLawOpeningBoards",
      "resetDepartmentAccounts",
      "federalBudget",
      "resetLawPrograms",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.resetLawOpeningBoards!.findOne.mockResolvedValue(board);
    db.collectionMocks.resetDepartmentAccounts!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(partition.accounts.filter((candidate) => candidate.countryId === "US")),
    });
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({ gdp: fiscal.US.gdp });
    db.collectionMocks.resetLawPrograms!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...enacted.option,
          annualAgencyAllocation: enacted.option.annualAllocation,
          supersededSourceIds: enacted.option.supersedesSourceIds,
          titleSnapshot: "Household Dividend Act",
          descriptionSnapshot: "The enacted household dividend program.",
        },
      ]),
    });

    const catalog = await loadReviewedLawCatalog({
      db: db as unknown as Db,
      worldId,
      country: "US",
      scope: "national",
      year: 1991,
    });
    const result = catalog.find((candidate) => candidate.familyId === "L01")!;
    const current = result.options.find(
      (candidate) => candidate.option.choice === enacted.option.choice
    )!;

    expect(result).toMatchObject({
      currentLaw: "Household Dividend Act",
      currentLawDescription: "The enacted household dividend program.",
      currentChoice: "far_left",
    });
    expect(current.currentAnnualAllocation).toBe(enacted.option.annualAllocation);
    expect(current.annualAllocationDelta).toBe(0);
    expect(
      result.options.find((candidate) => candidate.option.choice === "center_left")!
        .annualAllocationDelta
    ).toBe(
      result.options.find((candidate) => candidate.option.choice === "center_left")!.option
        .annualAllocation - enacted.option.annualAllocation
    );
  });
});
