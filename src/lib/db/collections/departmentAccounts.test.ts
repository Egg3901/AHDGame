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
          programId: "uk.health.fixture:option.l4",
          legislationTypeId: "uk.health.fixture",
          policyOptionId: "option.l4",
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
    });
    expect(
      budget?.departmentAccounts?.uk_health_department.programs["uk.health.fixture:option.l4"]
    ).toMatchObject({
      status: "operating",
      annualDemand: 4_800,
      encumbered: 20,
      cumulativeOutlays: 60,
    });
  });

  it("upgrades a legacy account whose arrears field is absent", async () => {
    const memory = createInMemoryDb();
    const definition = DEPARTMENT_DEFINITIONS.find(
      (candidate) => candidate.id === "uk_health_department"
    )!;
    const opening = createEmptyDepartmentAccount(definition);
    delete opening.arrears;
    memory.seed("federalBudget", [
      {
        _id: "UK",
        countryId: "UK",
        departmentAccounts: { uk_health_department: opening },
      },
    ]);
    const settlement = settleDepartmentAccount({
      departmentId: opening.departmentId,
      turn: 1,
      accruedThroughTurn: 0,
      openingBalance: 0,
      openingEncumbered: 0,
      openingArrears: 0,
      authority: 1,
      policy: { canOverdraft: false, usesEncumbrance: true, arrearsMode: "record" },
      programs: [],
    });

    expect(
      await applyCountryDepartmentSettlements(
        memory as unknown as Db,
        "UK",
        { uk_health_department: opening },
        new Set(),
        [settlement]
      )
    ).toBe(true);
    const budget = await (memory as unknown as Db)
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "UK" });
    expect(budget?.departmentAccounts?.uk_health_department).toMatchObject({
      balance: 1,
      arrears: 0,
      accruedThroughTurn: 1,
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

  it("attributes paid prior encumbrances to program cash outlays", async () => {
    const memory = createInMemoryDb();
    const definition = DEPARTMENT_DEFINITIONS.find(
      (candidate) => candidate.id === "uk_transport_department"
    )!;
    const opening = createEmptyDepartmentAccount(definition);
    opening.balance = 10;
    opening.encumbered = 10;
    opening.accruedThroughTurn = 1;
    opening.programs.project = {
      programId: "project",
      legislationTypeId: "uk.transport.project",
      policyOptionId: "l4",
      status: "winding_down",
      annualDemand: 0,
      periodDemand: 0,
      authorityThisTurn: 0,
      obligated: 10,
      encumbered: 10,
      outlaid: 0,
      cumulativeOutlays: 5,
      arrears: 0,
      fundingRatio: 1,
      capacityRatio: 1,
      coverageRatio: 0,
      rampFactor: 0,
      implementationFactor: 0,
      bindingConstraint: "coverage",
      lastSettledTurn: 1,
      repealTurn: 1,
    };
    memory.seed("federalBudget", [
      {
        _id: "UK",
        countryId: "UK",
        departmentAccounts: { uk_transport_department: opening },
      },
    ]);
    const settlement = settleDepartmentAccount({
      departmentId: opening.departmentId,
      turn: 2,
      accruedThroughTurn: 1,
      openingBalance: 10,
      openingEncumbered: 10,
      openingArrears: 0,
      authority: 0,
      policy: { canOverdraft: false, usesEncumbrance: true, arrearsMode: "record" },
      programs: [
        {
          programId: "project",
          legislationTypeId: "uk.transport.project",
          policyOptionId: "l4",
          status: "winding_down",
          priority: 2,
          annualDemand: 0,
          periodDemand: 0,
          requestedOutlay: 0,
          requestedEncumbrance: 0,
          openingEncumbered: 10,
          capacity: {
            capacityType: "wind_down",
            maintenanceDemand: 0,
            programDemand: 0,
            sourceBreakdown: { workforce: 0, facilities: 0, systems: 0, efficiency: 0 },
          },
          coverageRatio: 0,
          rampFactor: 0,
          createsArrearsOnShortfall: false,
          repealTurn: 1,
        },
      ],
    });
    expect(
      await applyCountryDepartmentSettlements(
        memory as unknown as Db,
        "UK",
        { uk_transport_department: opening },
        new Set(),
        [settlement]
      )
    ).toBe(true);
    const budget = await (memory as unknown as Db)
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "UK" });
    expect(budget?.departmentAccounts?.uk_transport_department.programs.project).toMatchObject({
      outlaid: 10,
      cumulativeOutlays: 15,
      encumbered: 0,
    });
  });

  it("rejects a stale settlement after Cabinet allocation changed", async () => {
    const memory = createInMemoryDb();
    const definition = DEPARTMENT_DEFINITIONS.find(
      (candidate) => candidate.id === "uk_health_department"
    )!;
    const opening = createEmptyDepartmentAccount(definition);
    opening.lastAllocationChangedTurn = 1;
    const stored = { ...opening, lastAllocationChangedTurn: 2 };
    memory.seed("federalBudget", [
      {
        _id: "UK",
        countryId: "UK",
        departmentAccounts: { uk_health_department: stored },
      },
    ]);
    const settlement = settleDepartmentAccount({
      departmentId: opening.departmentId,
      turn: 1,
      accruedThroughTurn: 0,
      openingBalance: 0,
      openingEncumbered: 0,
      openingArrears: 0,
      authority: 1,
      policy: { canOverdraft: false, usesEncumbrance: true, arrearsMode: "record" },
      programs: [],
    });
    expect(
      await applyCountryDepartmentSettlements(
        memory as unknown as Db,
        "UK",
        { uk_health_department: opening },
        new Set(),
        [settlement]
      )
    ).toBe(false);
  });
});
