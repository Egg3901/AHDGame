import { settleCapacity } from "./capacity";
import { allocateByPriority } from "./allocation";
import { currencyAmount, reconcileProgramSettlement } from "./reconciliation";
import { resolveProgramStatus } from "./repeal";
import type {
  DepartmentBindingConstraint,
  ImplementationFactors,
  ImplementationSettlement,
  ProgramAccountInput,
  ProgramAccountSettlement,
} from "./types";

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const CONSTRAINT_ORDER: Array<Exclude<DepartmentBindingConstraint, "none">> = [
  "funding",
  "capacity",
  "coverage",
  "ramp",
];

export function settleImplementation(factors: ImplementationFactors): ImplementationSettlement {
  const normalized: ImplementationFactors = {
    fundingRatio: clampRatio(factors.fundingRatio),
    capacityRatio: clampRatio(factors.capacityRatio),
    coverageRatio: clampRatio(factors.coverageRatio),
    rampFactor: clampRatio(factors.rampFactor),
  };
  const byConstraint = {
    funding: normalized.fundingRatio,
    capacity: normalized.capacityRatio,
    coverage: normalized.coverageRatio,
    ramp: normalized.rampFactor,
  };
  const minimum = Math.min(...Object.values(byConstraint));
  const bindingConstraint =
    minimum >= 1
      ? "none"
      : (CONSTRAINT_ORDER.find((constraint) => byConstraint[constraint] === minimum) ?? "none");

  const rawImplementationFactor =
    normalized.fundingRatio *
    normalized.capacityRatio *
    normalized.coverageRatio *
    normalized.rampFactor;

  return {
    ...normalized,
    // Keep serialized settlements stable across the server and headless harness.
    implementationFactor: Math.round(rawImplementationFactor * 1e12) / 1e12,
    bindingConstraint,
  };
}

export function settleProgramAccount(input: ProgramAccountInput): ProgramAccountSettlement {
  const openingBalance = currencyAmount(input.openingBalance, "openingBalance");
  const openingEncumbered = currencyAmount(input.openingEncumbered, "openingEncumbered");
  if (openingEncumbered > openingBalance) {
    throw new Error("openingEncumbered cannot exceed openingBalance");
  }

  const capacity = settleCapacity(input.capacity);
  const status = resolveProgramStatus(
    input.status,
    input.turn,
    input.repealTurn,
    openingEncumbered
  );
  const replayed = input.turn <= input.accruedThroughTurn;
  const authorityAccrued = replayed ? 0 : currencyAmount(input.authority, "authority");
  const programDemand = currencyAmount(input.programDemand, "programDemand");
  const spendable = openingBalance - openingEncumbered + authorityAccrued;
  const allocations = allocateByPriority(spendable, [
    { id: input.programId, priority: input.priority, requested: programDemand },
  ]);
  const allocated =
    status === "closed" || status === "winding_down" ? 0 : allocations[0]!.allocated;
  const requestedOutlay = replayed ? 0 : currencyAmount(input.requestedOutlay, "requestedOutlay");
  const requestedEncumbrance = replayed
    ? 0
    : currencyAmount(input.requestedEncumbrance, "requestedEncumbrance");
  const outlaid = Math.min(requestedOutlay, allocated, spendable);
  const afterOutlay = openingBalance + authorityAccrued - outlaid;
  const freeAfterOutlay = Math.max(0, afterOutlay - openingEncumbered);
  const newEncumbrance =
    status === "closed" || status === "winding_down"
      ? 0
      : Math.min(requestedEncumbrance, Math.max(0, allocated - outlaid), freeAfterOutlay);
  const closingBalance = afterOutlay;
  const closingEncumbered = openingEncumbered + newEncumbrance;
  const availableBalance = closingBalance - closingEncumbered;
  const obligated = outlaid + newEncumbrance;
  const fundingRatio = programDemand === 0 ? 1 : Math.min(1, authorityAccrued / programDemand);
  const implementation = settleImplementation({
    fundingRatio,
    capacityRatio: capacity.ratio,
    coverageRatio: input.coverageRatio,
    rampFactor: input.rampFactor,
  });

  const settlement: ProgramAccountSettlement = {
    programId: input.programId,
    legislationTypeId: input.legislationTypeId,
    policyOptionId: input.policyOptionId,
    status,
    replayed,
    turn: input.turn,
    authorityAccrued,
    programDemand,
    obligated,
    outlaid,
    newEncumbrance,
    closingBalance,
    closingEncumbered,
    availableBalance,
    arrears: 0,
    capacity,
    implementation,
    ...(input.repealTurn !== undefined ? { repealTurn: input.repealTurn } : {}),
  };
  const reconciliation = reconcileProgramSettlement(input, settlement);
  if (!reconciliation.ok) {
    throw new Error(
      `department settlement failed reconciliation: ${reconciliation.failures.join("; ")}`
    );
  }
  return settlement;
}
