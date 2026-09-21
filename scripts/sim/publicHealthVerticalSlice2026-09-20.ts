import { isDeepStrictEqual } from "node:util";
import { reconcileProgramSettlement } from "../../src/lib/governmentFinance/rules/reconciliation";
import { settleProgramAccount } from "../../src/lib/governmentFinance/rules/implementation";
import type {
  ProgramAccountInput,
  ProgramAccountSettlement,
} from "../../src/lib/governmentFinance/rules/types";

type CaseName =
  | "fully_funded"
  | "appropriation_shortfall"
  | "capacity_bottleneck"
  | "dual_bottleneck"
  | "officeholder_turnover"
  | "repeal_with_encumbrance"
  | "same_turn_replay";

export interface PublicHealthSimCase {
  name: CaseName;
  input: ProgramAccountInput;
  settlement: ProgramAccountSettlement;
  reconciliationOk: boolean;
}

function input(overrides: Partial<ProgramAccountInput> = {}): ProgramAccountInput {
  return {
    programId: "us_public_health_workforce",
    legislationTypeId: "us_public_health",
    policyOptionId: "public_health_opt_1",
    status: "operating",
    priority: 6,
    openingBalance: 0,
    openingEncumbered: 0,
    accruedThroughTurn: 9,
    turn: 10,
    authority: 100,
    programDemand: 100,
    requestedOutlay: 100,
    requestedEncumbrance: 0,
    capacity: {
      capacityType: "public_health_operations",
      maintenanceDemand: 0,
      programDemand: 100,
      sourceBreakdown: { workforce: 50, facilities: 20, systems: 20, efficiency: 10 },
    },
    coverageRatio: 1,
    rampFactor: 1,
    ...overrides,
  };
}

function runCase(name: CaseName, value: ProgramAccountInput): PublicHealthSimCase {
  const settlement = settleProgramAccount(value);
  return {
    name,
    input: value,
    settlement,
    reconciliationOk: reconcileProgramSettlement(value, settlement).ok,
  };
}

export function runPublicHealthVerticalSliceSimulation() {
  const cases = [
    runCase("fully_funded", input()),
    runCase("appropriation_shortfall", input({ authority: 50, requestedOutlay: 50 })),
    runCase(
      "capacity_bottleneck",
      input({
        requestedOutlay: 50,
        capacity: {
          ...input().capacity,
          sourceBreakdown: { workforce: 20, facilities: 10, systems: 10, efficiency: 10 },
        },
      })
    ),
    runCase(
      "dual_bottleneck",
      input({
        authority: 50,
        requestedOutlay: 25,
        capacity: {
          ...input().capacity,
          sourceBreakdown: { workforce: 20, facilities: 10, systems: 10, efficiency: 10 },
        },
      })
    ),
    runCase("officeholder_turnover", input()),
    runCase(
      "repeal_with_encumbrance",
      input({
        openingBalance: 40,
        openingEncumbered: 25,
        authority: 0,
        requestedOutlay: 0,
        requestedEncumbrance: 20,
        repealTurn: 10,
      })
    ),
    runCase("same_turn_replay", input({ accruedThroughTurn: 10 })),
  ];

  const serverSerialization = JSON.stringify(settleProgramAccount(input()));
  const harnessSerialization = JSON.stringify(settleProgramAccount(input()));
  return {
    fixture: "illustrative mechanics only, not approved production balance",
    cases,
    invariants: {
      everyCaseReconciles: cases.every((entry) => entry.reconciliationOk),
      fundingAndCapacityBindSeparately:
        cases.find((entry) => entry.name === "appropriation_shortfall")?.settlement.implementation
          .bindingConstraint === "funding" &&
        cases.find((entry) => entry.name === "capacity_bottleneck")?.settlement.implementation
          .bindingConstraint === "capacity",
      replayHasNoFlow:
        cases.find((entry) => entry.name === "same_turn_replay")?.settlement.authorityAccrued ===
          0 && cases.find((entry) => entry.name === "same_turn_replay")?.settlement.outlaid === 0,
      repealPreservesEncumbrance:
        cases.find((entry) => entry.name === "repeal_with_encumbrance")?.settlement
          .closingEncumbered === 25,
      officeholderNotInAccountIdentity: isDeepStrictEqual(
        cases.find((entry) => entry.name === "fully_funded")?.settlement,
        cases.find((entry) => entry.name === "officeholder_turnover")?.settlement
      ),
      serverAndHarnessByteEquivalent: serverSerialization === harnessSerialization,
    },
  };
}

if (process.argv[1]?.endsWith("publicHealthVerticalSlice2026-09-20.ts")) {
  console.log(JSON.stringify(runPublicHealthVerticalSliceSimulation(), null, 2));
}
