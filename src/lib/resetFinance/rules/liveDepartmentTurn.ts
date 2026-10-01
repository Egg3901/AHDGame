/** Portable Cabinet account settlement for an already-paid sovereign authority share. */
import { includedAuthorityPerTurn } from "@/lib/governmentFinance/rules/appropriation";
import { settleDepartmentAccount } from "@/lib/governmentFinance/rules/departmentSettlement";
import type {
  DepartmentAccountSettlement,
  DepartmentProgramClaimInput,
} from "@/lib/governmentFinance/rules/types";
import type { ResetDepartmentAccountSnapshot } from "./liveDepartmentAccount";

function integerAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function annualRequest(base: number, percent: number): number {
  integerAmount(base, "family annual demand");
  if (!Number.isSafeInteger(percent) || percent < 0 || percent > 200) {
    throw new Error("Cabinet allocation must be an integer percent from 0 to 200");
  }
  const result = Number((BigInt(base) * BigInt(percent) + BigInt(50)) / BigInt(100));
  return integerAmount(result, "authored annual request");
}

export interface LiveDepartmentTurnResult {
  next: ResetDepartmentAccountSnapshot;
  scheduledAuthority: number;
  settlement: DepartmentAccountSettlement | null;
  /** Opening 1991 claims assume existing administrative capacity until measured. */
  capacityBasis: "1991-existing-service-proxy" | "externally-settled";
}

/**
 * Treasury pays first. This rule can only allocate the share actually paid to
 * an ordinary department. Defense and intelligence keep their existing shells.
 */
export function settleLiveDepartmentTurn(input: {
  account: ResetDepartmentAccountSnapshot;
  turn: number;
  authorityPaid: number;
}): LiveDepartmentTurnResult {
  const { account, turn } = input;
  if (!Number.isSafeInteger(turn) || turn <= account.sourceTurn) {
    throw new Error("Cabinet turn must follow its world opening");
  }
  // Family schedules, rather than an independently rounded account total,
  // keep per-turn requests and paid authority aligned to the unit.
  const scheduledAuthority = Object.values(account.familyAnnualDemand).reduce(
    (sum, amount) => sum + includedAuthorityPerTurn(amount, turn),
    0
  );
  const authorityPaid = integerAmount(input.authorityPaid, "paid Cabinet authority");
  const replaying = account.accruedThroughTurn === turn;
  const unpaidAuthority = integerAmount(account.unpaidAuthority ?? 0, "unpaid authority");
  if (!replaying && authorityPaid > scheduledAuthority + unpaidAuthority) {
    throw new Error("Cabinet account cannot receive authority the treasury did not schedule");
  }
  if (account.externallySettled) {
    if (authorityPaid !== 0) {
      throw new Error("Specialized department authority belongs to its existing account shell");
    }
    return {
      next: account,
      scheduledAuthority,
      settlement: null,
      capacityBasis: "externally-settled",
    };
  }
  if (account.accruedThroughTurn !== turn - 1 && account.accruedThroughTurn !== turn) {
    throw new Error("Cabinet account turn must advance once or replay");
  }
  if (account.accruedThroughTurn === turn && authorityPaid !== account.lastAuthorityPaid) {
    throw new Error("Cabinet replay differs from paid authority");
  }
  const familyEntries = Object.entries(account.familyAnnualDemand).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  if (
    familyEntries.reduce((sum, [, amount]) => sum + integerAmount(amount, "family demand"), 0) !==
    account.annualAuthority
  ) {
    throw new Error("Cabinet family demands do not equal department authority");
  }
  const unknownAllocation = Object.keys(account.programAllocationPercents).find(
    (familyId) => account.familyAnnualDemand[familyId] === undefined
  );
  if (unknownAllocation) throw new Error(`Unknown Cabinet family allocation ${unknownAllocation}`);
  const programs: DepartmentProgramClaimInput[] = familyEntries.map(([familyId, baseAnnual]) => {
    const percent = account.programAllocationPercents[familyId] ?? 100;
    const requestedAnnual = annualRequest(baseAnnual, percent);
    const basePeriod = includedAuthorityPerTurn(baseAnnual, turn);
    const requestedPeriod = includedAuthorityPerTurn(requestedAnnual, turn);
    return {
      programId: familyId,
      legislationTypeId: familyId,
      policyOptionId: "1991-opening-service",
      status: "operating",
      priority: 5,
      annualDemand: requestedAnnual,
      periodDemand: requestedPeriod,
      requestedOutlay: requestedPeriod,
      requestedEncumbrance: 0,
      capacity: {
        capacityType: "1991-existing-service-proxy",
        maintenanceDemand: 0,
        programDemand: 1,
        sourceBreakdown: { workforce: 1, facilities: 0, systems: 0, efficiency: 0 },
      },
      coverageRatio: basePeriod === 0 ? 1 : Math.min(1, requestedPeriod / basePeriod),
      rampFactor: 1,
      createsArrearsOnShortfall: false,
    };
  });
  const settlement = settleDepartmentAccount({
    departmentId: account.departmentId,
    turn,
    accruedThroughTurn: account.accruedThroughTurn,
    openingBalance: account.balance,
    openingEncumbered: account.encumbered,
    openingArrears: account.arrears,
    authority: authorityPaid,
    policy: { canOverdraft: false, usesEncumbrance: true, arrearsMode: "record" },
    programs,
  });
  return {
    next: settlement.replayed
      ? account
      : {
          ...account,
          accruedThroughTurn: turn,
          lastAuthorityPaid: authorityPaid,
          unpaidAuthority: scheduledAuthority + unpaidAuthority - authorityPaid,
          balance: settlement.closingBalance,
          encumbered: settlement.closingEncumbered,
          arrears: settlement.closingArrears,
          lastProgramDelivery: Object.fromEntries(
            settlement.programs.map((program) => [
              program.programId,
              {
                requested: program.requested,
                outlaid: program.outlaid,
                implementationFactor: program.implementation.implementationFactor,
              },
            ])
          ),
        },
    scheduledAuthority,
    settlement,
    capacityBasis: "1991-existing-service-proxy",
  };
}
