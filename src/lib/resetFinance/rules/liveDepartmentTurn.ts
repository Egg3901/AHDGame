/** Portable Cabinet account settlement for an already-paid sovereign authority share. */
import { includedAuthorityPerTurn } from "@/lib/governmentFinance/rules/appropriation";
import { settleDepartmentAccount } from "@/lib/governmentFinance/rules/departmentSettlement";
import type {
  DepartmentAccountSettlement,
  DepartmentProgramClaimInput,
} from "@/lib/governmentFinance/rules/types";
import type { ResetDepartmentAccountSnapshot } from "./liveDepartmentAccount";
import {
  openingLawFundingControl,
  type LawFundingControl,
} from "@/lib/resetLegislation/rules/fundingControl";
import { annualProgramFundingRequest } from "./programRequest";

function integerAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
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
  fundingControls?: Readonly<Record<string, LawFundingControl>>;
  activeFamilyIds?: readonly string[];
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
  const activeFamilyIds = input.activeFamilyIds
    ? new Set(input.activeFamilyIds)
    : new Set(Object.keys(account.familyAnnualDemand));
  if (activeFamilyIds.size !== (input.activeFamilyIds?.length ?? activeFamilyIds.size)) {
    throw new Error("Cabinet active family roster contains duplicates");
  }
  const unknownActiveFamily = [...activeFamilyIds].find(
    (familyId) => account.familyAnnualDemand[familyId] === undefined
  );
  if (unknownActiveFamily) {
    throw new Error(`Unknown active Cabinet family ${unknownActiveFamily}`);
  }
  const inactiveAuthority = Object.entries(account.familyAnnualDemand).find(
    ([familyId, amount]) => !activeFamilyIds.has(familyId) && amount !== 0
  );
  if (inactiveAuthority) {
    throw new Error(`Inactive Cabinet family retains authority ${inactiveAuthority[0]}`);
  }
  const familyEntries = Object.entries(account.familyAnnualDemand)
    .filter(([familyId]) => activeFamilyIds.has(familyId))
    .sort(([a], [b]) => a.localeCompare(b));
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
    const fundingControl =
      input.fundingControls?.[familyId] ??
      openingLawFundingControl({
        country: account.countryId,
        familyId,
        annualAllocation: baseAnnual,
      });
    const percent =
      fundingControl === "adjustable" ? (account.programAllocationPercents[familyId] ?? 100) : 100;
    const requestedAnnual = annualProgramFundingRequest(baseAnnual, percent);
    const basePeriod = includedAuthorityPerTurn(baseAnnual, turn);
    const requestedPeriod = includedAuthorityPerTurn(requestedAnnual, turn);
    return {
      programId: familyId,
      legislationTypeId: familyId,
      policyOptionId: "1991-opening-service",
      status: "operating",
      priority: 5,
      // Required programs settle first. Adjustable programs then settle from
      // the lowest authored percentage to the highest, with equal percentages
      // sharing the same order group.
      allocationOrder: fundingControl === "required" ? 0 : percent + 1,
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
