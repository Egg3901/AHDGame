import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  createEmptyDepartmentAccount,
  createEmptyUsHealthDepartmentAccount,
} from "@/lib/governmentFinance/departments";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { settleProgramAccount } from "@/lib/governmentFinance/rules/implementation";
import { settleDepartmentAccount } from "@/lib/governmentFinance/rules/departmentSettlement";
import {
  applyDepartmentAccountSettlement,
  applyCountryDepartmentSettlements,
  applyDepartmentProgramSettlement,
  ensureDepartmentAccount,
} from "./departmentAccounts";

describe("department account persistence", () => {
  it("initializes an absent account to zero without touching treasury", async () => {
    const memory = createInMemoryDb();
    memory.seed("federalBudget", [{ _id: "federal", countryId: "US", treasuryBalance: 123 }]);
    const account = await ensureDepartmentAccount(
      memory as unknown as Db,
      "US",
      "us_health_department"
    );
    expect(account).toMatchObject({ balance: 0, encumbered: 0, programs: {} });
    const budget = await (memory as unknown as Db)
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "US" });
    expect(budget?.treasuryBalance).toBe(123);
  });

  it("initializes any cataloged spending department including a finance ministry", async () => {
    const memory = createInMemoryDb();
    memory.seed("federalBudget", [{ _id: "UK", countryId: "UK", treasuryBalance: 456 }]);
    const transport = await ensureDepartmentAccount(
      memory as unknown as Db,
      "UK",
      "uk_transport_department"
    );
    const treasury = await ensureDepartmentAccount(memory as unknown as Db, "UK", "uk_treasury");
    expect(transport).toMatchObject({
      departmentId: "uk_transport_department",
      portfolioIds: ["transport_infrastructure"],
      accountPolicyId: "civil_capital",
      balance: 0,
      arrears: 0,
    });
    expect(treasury).toMatchObject({
      departmentId: "uk_treasury",
      accountPolicyId: "civil_operating",
      balance: 0,
    });
    const budget = await (memory as unknown as Db)
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "UK" });
    expect(budget?.treasuryBalance).toBe(456);
  });

  it("commits a turn once under balance and turn guards", async () => {
    const memory = createInMemoryDb();
    const opening = createEmptyUsHealthDepartmentAccount();
    memory.seed("federalBudget", [
      {
        _id: "federal",
        countryId: "US",
        treasuryBalance: 123,
        departmentAccounts: { us_health_department: opening },
      },
    ]);
    const settlement = settleProgramAccount({
      programId: "us_public_health_workforce",
      legislationTypeId: "us_public_health",
      policyOptionId: "public_health_opt_1",
      status: "authorized",
      priority: 6,
      openingBalance: 0,
      openingEncumbered: 0,
      accruedThroughTurn: 0,
      turn: 1,
      authority: 100,
      programDemand: 100,
      requestedOutlay: 60,
      requestedEncumbrance: 20,
      capacity: {
        capacityType: "public_health_operations",
        maintenanceDemand: 0,
        programDemand: 100,
        sourceBreakdown: { workforce: 40, facilities: 20, systems: 20, efficiency: 20 },
      },
      coverageRatio: 1,
      rampFactor: 1,
    });
    expect(
      await applyDepartmentProgramSettlement(
        memory as unknown as Db,
        "US",
        "us_health_department",
        opening,
        settlement
      )
    ).toBe(true);
    expect(
      await applyDepartmentProgramSettlement(
        memory as unknown as Db,
        "US",
        "us_health_department",
        opening,
        settlement
      )
    ).toBe(false);

    const after = await (memory as unknown as Db)
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "US" });
    expect(after?.treasuryBalance).toBe(123);
    expect(after?.departmentAccounts?.us_health_department).toMatchObject({
      balance: 40,
      encumbered: 20,
      accruedThroughTurn: 1,
    });
  });

  it("atomically commits a generalized multi-program settlement without touching treasury", async () => {
    const memory = createInMemoryDb();
    memory.seed("federalBudget", [{ _id: "UK", countryId: "UK", treasuryBalance: 456 }]);
    const opening = await ensureDepartmentAccount(
      memory as unknown as Db,
      "UK",
      "uk_health_department"
    );
    expect(opening).not.toBeNull();
    const settlement = settleDepartmentAccount({
      departmentId: opening!.departmentId,
      turn: 1,
      accruedThroughTurn: opening!.accruedThroughTurn,
      openingBalance: opening!.balance,
      openingEncumbered: opening!.encumbered,
      openingArrears: opening!.arrears ?? 0,
      authority: 100,
      policy: { canOverdraft: false, usesEncumbrance: true, arrearsMode: "record" },
      programs: [
        {
          programId: "uk_health_fixture",
          legislationTypeId: "uk_nhs_funding",
          policyOptionId: "uk_nhs_funding_opt_3",
          status: "authorized",
          priority: 5,
          annualDemand: 4_800,
          periodDemand: 100,
          requestedOutlay: 60,
          requestedEncumbrance: 20,
          capacity: {
            capacityType: "health_service_delivery",
            maintenanceDemand: 0,
            programDemand: 100,
            sourceBreakdown: { workforce: 40, facilities: 30, systems: 20, efficiency: 10 },
          },
          coverageRatio: 1,
          rampFactor: 1,
          createsArrearsOnShortfall: false,
        },
      ],
    });
    expect(
      await applyDepartmentAccountSettlement(memory as unknown as Db, "UK", opening!, settlement)
    ).toBe(true);
    expect(
      await applyDepartmentAccountSettlement(memory as unknown as Db, "UK", opening!, settlement)
    ).toBe(false);
    const budget = await (memory as unknown as Db)
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "UK" });
    expect(budget?.treasuryBalance).toBe(456);
    expect(budget?.departmentAccounts?.uk_health_department).toMatchObject({
      balance: 40,
      encumbered: 20,
      arrears: 0,
      accruedThroughTurn: 1,
      programs: {
        uk_health_fixture: {
          status: "operating",
          annualDemand: 4_800,
          encumbered: 20,
          cumulativeOutlays: 60,
        },
      },
    });
  });

  it("creates and settles multiple department accounts in one guarded country write", async () => {
    const memory = createInMemoryDb();
    memory.seed("federalBudget", [{ _id: "JP", countryId: "JP", treasuryBalance: 789 }]);
    const definitions = ["jp_health_labor_ministry", "jp_land_ministry"].map((id) =>
      DEPARTMENT_DEFINITIONS.find((definition) => definition.id === id)
    );
    const openings = Object.fromEntries(
      definitions.map((definition) => {
        if (!definition) throw new Error("fixture department missing");
        const account = createEmptyDepartmentAccount(definition);
        return [account.departmentId, account];
      })
    );
    const settlements = Object.values(openings).map((opening) =>
      settleDepartmentAccount({
        departmentId: opening.departmentId,
        turn: 1,
        accruedThroughTurn: 0,
        openingBalance: 0,
        openingEncumbered: 0,
        openingArrears: 0,
        authority: 50,
        policy: { canOverdraft: false, usesEncumbrance: true, arrearsMode: "record" },
        programs: [
          {
            programId: `${opening.departmentId}_fixture`,
            legislationTypeId: "fixture",
            policyOptionId: "fixture_option",
            status: "authorized",
            priority: 5,
            annualDemand: 2_400,
            periodDemand: 50,
            requestedOutlay: 50,
            requestedEncumbrance: 0,
            capacity: {
              capacityType: "fixture",
              maintenanceDemand: 0,
              programDemand: 1,
              sourceBreakdown: { workforce: 1, facilities: 0, systems: 0, efficiency: 0 },
            },
            coverageRatio: 1,
            rampFactor: 1,
            createsArrearsOnShortfall: false,
          },
        ],
      })
    );
    expect(
      await applyCountryDepartmentSettlements(
        memory as unknown as Db,
        "JP",
        openings,
        new Set(Object.keys(openings)),
        settlements
      )
    ).toBe(true);
    const budget = await (memory as unknown as Db)
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "JP" });
    expect(budget?.treasuryBalance).toBe(789);
    expect(Object.keys(budget?.departmentAccounts ?? {}).sort()).toEqual([
      "jp_health_labor_ministry",
      "jp_land_ministry",
    ]);
  });
});
