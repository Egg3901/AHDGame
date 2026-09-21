/**
 * Department settlement. Protected arrears and contracts are paid before
 * current programs, then same-tier shortfalls are distributed pro rata.
 */
import { allocateByPriority } from "./allocation";
import { settleCapacity } from "./capacity";
import { clampRatio, settleImplementation } from "./implementation";
import { currencyAmount } from "./reconciliation";
import { resolveProgramStatus } from "./repeal";
import type {
  DepartmentAccountSettlement,
  DepartmentAccountSettlementInput,
  DepartmentProgramClaimInput,
  DepartmentProgramClaimSettlement,
  PriorityClaim,
} from "./types";

const ARREARS_CLAIM = "__protected_arrears__";
const UNATTRIBUTED_ENCUMBRANCE_CLAIM = "__protected_encumbrance__";

function encumbranceClaimId(programId: string): string {
  return `__protected_encumbrance__:${programId}`;
}

function requestedFor(program: DepartmentProgramClaimInput): number {
  const periodDemand = currencyAmount(program.periodDemand, `${program.programId}.periodDemand`);
  const obligation =
    currencyAmount(program.requestedOutlay, `${program.programId}.requestedOutlay`) +
    currencyAmount(program.requestedEncumbrance, `${program.programId}.requestedEncumbrance`);
  if (obligation > periodDemand) {
    throw new Error(`program obligation exceeds period demand: ${program.programId}`);
  }
  return periodDemand;
}

function emptyReplay(input: DepartmentAccountSettlementInput): DepartmentAccountSettlement {
  return {
    departmentId: input.departmentId,
    turn: input.turn,
    replayed: true,
    authorityAccrued: 0,
    arrearsPaid: 0,
    encumbrancePaid: 0,
    programOutlays: 0,
    totalOutlays: 0,
    newEncumbrance: 0,
    newArrears: 0,
    overdraft: 0,
    closingBalance: currencyAmount(input.openingBalance, "openingBalance"),
    closingEncumbered: currencyAmount(input.openingEncumbered, "openingEncumbered"),
    closingArrears: currencyAmount(input.openingArrears, "openingArrears"),
    programs: [],
  };
}

function assertUniquePrograms(programs: DepartmentProgramClaimInput[]): void {
  const ids = new Set<string>();
  for (const program of programs) {
    if (ids.has(program.programId))
      throw new Error(`duplicate department program: ${program.programId}`);
    ids.add(program.programId);
  }
}

export function settleDepartmentAccount(
  input: DepartmentAccountSettlementInput
): DepartmentAccountSettlement {
  const openingBalance = currencyAmount(input.openingBalance, "openingBalance");
  const openingEncumbered = currencyAmount(input.openingEncumbered, "openingEncumbered");
  const openingArrears = currencyAmount(input.openingArrears, "openingArrears");
  if (openingEncumbered > openingBalance) {
    throw new Error("openingEncumbered cannot exceed openingBalance");
  }
  assertUniquePrograms(input.programs);
  if (input.turn <= input.accruedThroughTurn) return emptyReplay(input);

  const authorityAccrued = currencyAmount(input.authority, "authority");
  const programRequests = input.programs.map((program) => {
    const status = resolveProgramStatus(
      program.status,
      input.turn,
      program.repealTurn,
      program.openingEncumbered ?? 0
    );
    return {
      program,
      openingEncumbered: currencyAmount(
        program.openingEncumbered ?? 0,
        `${program.programId}.openingEncumbered`
      ),
      requested: status === "closed" || status === "winding_down" ? 0 : requestedFor(program),
      status,
    };
  });
  const attributedEncumbrance = programRequests.reduce(
    (sum, program) => sum + program.openingEncumbered,
    0
  );
  if (attributedEncumbrance > openingEncumbered) {
    throw new Error("program encumbrances exceed the department encumbrance");
  }
  const unattributedEncumbrance = openingEncumbered - attributedEncumbrance;
  const eligibleRequests = programRequests.filter(
    ({ status }) => status !== "closed" && status !== "winding_down"
  );

  const claims: PriorityClaim[] = [
    { id: ARREARS_CLAIM, priority: 1, requested: openingArrears },
    ...programRequests.map(({ program, openingEncumbered: amount }) => ({
      id: encumbranceClaimId(program.programId),
      priority: 2 as const,
      requested: amount,
    })),
    {
      id: UNATTRIBUTED_ENCUMBRANCE_CLAIM,
      priority: 2,
      requested: unattributedEncumbrance,
    },
    ...eligibleRequests.map(({ program, requested }) => ({
      id: program.programId,
      priority: program.priority,
      requested,
      ...(program.allocationWeight !== undefined
        ? { allocationWeight: program.allocationWeight }
        : {}),
    })),
  ];
  const lawfulDemand = claims.reduce((sum, claim) => sum + claim.requested, 0);
  const availableWithoutOverdraft = openingBalance + authorityAccrued;
  const overdraft = input.policy.canOverdraft
    ? Math.max(0, lawfulDemand - availableWithoutOverdraft)
    : 0;
  const allocations = allocateByPriority(availableWithoutOverdraft + overdraft, claims);
  const allocationById = new Map(allocations.map((allocation) => [allocation.id, allocation]));
  const arrearsPaid = allocationById.get(ARREARS_CLAIM)?.allocated ?? 0;
  const encumbrancePaid =
    (allocationById.get(UNATTRIBUTED_ENCUMBRANCE_CLAIM)?.allocated ?? 0) +
    programRequests.reduce(
      (sum, { program }) =>
        sum + (allocationById.get(encumbranceClaimId(program.programId))?.allocated ?? 0),
      0
    );

  const programs: DepartmentProgramClaimSettlement[] = programRequests.map(
    ({ program, openingEncumbered: programOpeningEncumbered, requested, status }) => {
      const allocated = allocationById.get(program.programId)?.allocated ?? 0;
      const programEncumbrancePaid =
        allocationById.get(encumbranceClaimId(program.programId))?.allocated ?? 0;
      const requestedOutlay = currencyAmount(
        program.requestedOutlay,
        `${program.programId}.requestedOutlay`
      );
      const outlaid = Math.min(requestedOutlay, allocated);
      const encumbranceSpace = Math.max(0, allocated - outlaid);
      const requestedEncumbrance = currencyAmount(
        program.requestedEncumbrance,
        `${program.programId}.requestedEncumbrance`
      );
      const newEncumbrance = input.policy.usesEncumbrance
        ? Math.min(requestedEncumbrance, encumbranceSpace)
        : 0;
      const unpaid = Math.max(0, requested - allocated);
      const newArrears =
        input.policy.arrearsMode === "record" && program.createsArrearsOnShortfall ? unpaid : 0;
      const capacity = settleCapacity(program.capacity);
      const fundingRatio = requested === 0 ? 1 : clampRatio(allocated / requested);
      return {
        programId: program.programId,
        legislationTypeId: program.legislationTypeId,
        policyOptionId: program.policyOptionId,
        status,
        priority: program.priority,
        annualDemand: currencyAmount(program.annualDemand, `${program.programId}.annualDemand`),
        requested,
        allocated,
        outlaid,
        encumbrancePaid: programEncumbrancePaid,
        newEncumbrance,
        closingEncumbered: programOpeningEncumbered - programEncumbrancePaid + newEncumbrance,
        newArrears,
        implementation: settleImplementation({
          fundingRatio,
          capacityRatio: capacity.ratio,
          coverageRatio: program.coverageRatio,
          rampFactor: program.rampFactor,
        }),
        capacity,
        ...(program.jurisdictionMode ? { jurisdictionMode: program.jurisdictionMode } : {}),
        ...(program.implementationMode ? { implementationMode: program.implementationMode } : {}),
        ...(program.repealTurn !== undefined ? { repealTurn: program.repealTurn } : {}),
      };
    }
  );

  const programOutlays = programs.reduce((sum, program) => sum + program.outlaid, 0);
  const totalOutlays = arrearsPaid + encumbrancePaid + programOutlays;
  const newEncumbrance = programs.reduce((sum, program) => sum + program.newEncumbrance, 0);
  const newArrears = programs.reduce((sum, program) => sum + program.newArrears, 0);
  const closingBalance = openingBalance + authorityAccrued + overdraft - totalOutlays;
  const closingEncumbered = openingEncumbered - encumbrancePaid + newEncumbrance;
  const closingArrears = openingArrears - arrearsPaid + newArrears;

  if (closingBalance < 0 || closingEncumbered < 0 || closingArrears < 0) {
    throw new Error("department settlement produced a negative monetary field");
  }
  if (closingEncumbered > closingBalance) {
    throw new Error("department settlement encumbered more than its closing balance");
  }
  const sources = openingBalance + authorityAccrued + overdraft;
  if (sources !== totalOutlays + closingBalance) {
    throw new Error("department settlement failed money conservation");
  }

  return {
    departmentId: input.departmentId,
    turn: input.turn,
    replayed: false,
    authorityAccrued,
    arrearsPaid,
    encumbrancePaid,
    programOutlays,
    totalOutlays,
    newEncumbrance,
    newArrears,
    overdraft,
    closingBalance,
    closingEncumbered,
    closingArrears,
    programs,
  };
}
