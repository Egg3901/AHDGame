/**
 * Portable opening account identity for v2 Cabinet finance. The 1991 claim
 * book is partitioned once; an account is not a second treasury expense.
 */
import type { DepartmentDefinition } from "@/lib/governmentFinance/departmentCatalog";
import type { ResetDepartmentOpeningBoard } from "./departmentBoard";

export interface ResetDepartmentAccountSnapshot {
  _id: string;
  worldId: string;
  countryId: ResetDepartmentOpeningBoard["countryId"];
  departmentId: string;
  controllingSeatId: string;
  openingAgencyNames: string[];
  sourceTurn: number;
  accruedThroughTurn: number;
  lastAuthorityPaid: number;
  /** Unpaid, enacted authority retained until the treasury actually pays it. */
  unpaidAuthority?: number;
  grossAnnualClaim: number;
  grantReservation: number;
  annualAuthority: number;
  balance: number;
  encumbered: number;
  arrears: number;
  /** Defense and intelligence retain their established account shell. */
  externallySettled: boolean;
  familyGrossAnnualDemand: Record<string, number>;
  familyGrantReservation: Record<string, number>;
  familyAnnualDemand: Record<string, number>;
  programAllocationPercents: Record<string, number>;
  /** Last paid turn's per-family delivery, never a second spending ledger. */
  lastProgramDelivery: Record<
    string,
    { requested: number; outlaid: number; implementationFactor: number }
  >;
  lastAllocationChangedTurn?: number;
  lastAllocationChangedBy?: string;
}

export interface ResetDepartmentContinuitySnapshot {
  _id: string;
  worldId: string;
  countryId: ResetDepartmentOpeningBoard["countryId"];
  sourceTurn: number;
  grossAnnualClaim: number;
  grantReservation: number;
  annualAuthority: number;
}

export interface OpeningDepartmentFundingPartition {
  accounts: ResetDepartmentAccountSnapshot[];
  continuity: ResetDepartmentContinuitySnapshot[];
}

function activeDefinition(
  definitions: readonly DepartmentDefinition[],
  board: ResetDepartmentOpeningBoard,
  seatId: string
): DepartmentDefinition {
  const matches = definitions.filter(
    (definition) =>
      definition.countryId === board.countryId &&
      definition.controllingPositionIds.includes(seatId) &&
      definition.accountPolicyId &&
      definition.activeFromYear <= 1991 &&
      (definition.activeToYear === undefined || definition.activeToYear >= 1991) &&
      (!definition.requiresEnabledSeatId || definition.requiresEnabledSeatId === seatId)
  );
  // A Cabinet member can coordinate another institution without its Treasury
  // bucket becoming the ministry's own. The opening seat claim belongs to the
  // controller-named department; subsidiary agencies keep their own identity.
  const owning =
    matches.length > 1
      ? matches.filter((definition) => definition.usesControllerDepartmentName !== false)
      : matches;
  if (owning.length !== 1) {
    throw new Error(`Ambiguous 1991 department for ${board.countryId}:${seatId}`);
  }
  return owning[0]!;
}

export function buildOpeningDepartmentFundingPartition(
  boards: readonly ResetDepartmentOpeningBoard[],
  definitions: readonly DepartmentDefinition[],
  grantEnvelope: Readonly<Record<ResetDepartmentOpeningBoard["countryId"], number>>,
  namedGrantByFamily: Readonly<
    Record<ResetDepartmentOpeningBoard["countryId"], Readonly<Record<string, number>>>
  >
): OpeningDepartmentFundingPartition {
  const accounts = new Map<string, ResetDepartmentAccountSnapshot>();
  for (const board of boards) {
    for (const opening of board.accounts) {
      const definition = activeDefinition(definitions, board, opening.seatId);
      const id = `${board.countryId}:${definition.id}`;
      const existing = accounts.get(id);
      if (existing && existing.controllingSeatId !== opening.seatId) {
        throw new Error(`Two Cabinet seats control opening department ${id}`);
      }
      const next: ResetDepartmentAccountSnapshot = existing ?? {
        _id: id,
        worldId: board.worldId,
        countryId: board.countryId,
        departmentId: definition.id,
        controllingSeatId: opening.seatId,
        openingAgencyNames: [],
        sourceTurn: board.sourceTurn,
        accruedThroughTurn: board.sourceTurn,
        lastAuthorityPaid: 0,
        grossAnnualClaim: 0,
        grantReservation: 0,
        annualAuthority: 0,
        balance: 0,
        encumbered: 0,
        arrears: 0,
        externallySettled:
          definition.accountPolicyId === "defense" || definition.accountPolicyId === "intelligence",
        familyGrossAnnualDemand: {},
        familyGrantReservation: {},
        familyAnnualDemand: {},
        programAllocationPercents: {},
        lastProgramDelivery: {},
      };
      if (next.worldId !== board.worldId || next.sourceTurn !== board.sourceTurn) {
        throw new Error(`Inconsistent opening account world for ${id}`);
      }
      if (!next.openingAgencyNames.includes(opening.agencyName)) {
        next.openingAgencyNames.push(opening.agencyName);
      }
      next.grossAnnualClaim += opening.annualAllocation;
      next.annualAuthority += opening.annualAllocation;
      for (const [familyId, amount] of Object.entries(opening.familyAllocations)) {
        if (next.familyAnnualDemand[familyId] !== undefined) {
          throw new Error(`Duplicate opening family ${board.countryId}:${familyId}`);
        }
        next.familyGrossAnnualDemand[familyId] = amount;
        next.familyAnnualDemand[familyId] = amount;
      }
      accounts.set(id, next);
    }
  }
  const result = [...accounts.values()];
  const continuity: ResetDepartmentContinuitySnapshot[] = [];
  for (const board of boards) {
    let remainingGrant = grantEnvelope[board.countryId];
    if (!Number.isSafeInteger(remainingGrant) || remainingGrant < 0) {
      throw new Error(`Invalid opening grant reserve ${board.countryId}`);
    }
    const countryAccounts = result.filter((account) => account.countryId === board.countryId);
    const reserve = (account: ResetDepartmentAccountSnapshot, familyId: string, amount: number) => {
      const familyDemand = account.familyAnnualDemand[familyId];
      if (
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        familyDemand === undefined ||
        amount > familyDemand
      ) {
        throw new Error(`Invalid grant reserve against ${account._id}:${familyId}`);
      }
      account.familyAnnualDemand[familyId] = familyDemand - amount;
      account.familyGrantReservation[familyId] =
        (account.familyGrantReservation[familyId] ?? 0) + amount;
      account.annualAuthority -= amount;
      account.grantReservation += amount;
      remainingGrant -= amount;
    };
    // Explicitly named transfers are reserved against their actual fiscal
    // family. Unattributed grants remain in continuity and cannot be released
    // by an unrelated law-family replacement.
    for (const [familyId, amount] of Object.entries(namedGrantByFamily[board.countryId])) {
      const owner = countryAccounts.find((account) => account.familyAnnualDemand[familyId]);
      if (!owner || owner.externallySettled || amount > remainingGrant) {
        throw new Error(`Invalid named grant owner ${board.countryId}:${familyId}`);
      }
      reserve(owner, familyId, amount);
    }
    if (remainingGrant > board.continuityAmount) {
      throw new Error(`Unattributed grant reserve exceeds continuity ${board.countryId}`);
    }
    const netContinuity = board.continuityAmount - remainingGrant;
    continuity.push({
      _id: board.countryId,
      worldId: board.worldId,
      countryId: board.countryId,
      sourceTurn: board.sourceTurn,
      grossAnnualClaim: board.continuityAmount,
      grantReservation: remainingGrant,
      annualAuthority: netContinuity,
    });
    const owned = countryAccounts.reduce((sum, account) => sum + account.annualAuthority, 0);
    if (Math.abs(owned + netContinuity + grantEnvelope[board.countryId] - board.operating) > 0.01) {
      throw new Error(`Live 1991 accounts do not reconcile ${board.countryId}`);
    }
  }
  return { accounts: result, continuity };
}

export function openingDepartmentContinuityPayload(
  rows: readonly ResetDepartmentContinuitySnapshot[]
): string {
  const countries = new Set<string>();
  return JSON.stringify(
    [...rows]
      .sort((a, b) => a._id.localeCompare(b._id))
      .map((row) => {
        if (
          countries.has(row.countryId) ||
          row._id !== row.countryId ||
          !row.worldId ||
          !Number.isSafeInteger(row.sourceTurn) ||
          !Number.isSafeInteger(row.grossAnnualClaim) ||
          !Number.isSafeInteger(row.grantReservation) ||
          !Number.isSafeInteger(row.annualAuthority) ||
          row.annualAuthority < 0 ||
          row.grossAnnualClaim !== row.annualAuthority + row.grantReservation
        ) {
          throw new Error(`Invalid department continuity ${row._id}`);
        }
        countries.add(row.countryId);
        return [
          row._id,
          row.worldId,
          row.countryId,
          row.sourceTurn,
          row.grossAnnualClaim,
          row.grantReservation,
          row.annualAuthority,
        ];
      })
  );
}

export function openingDepartmentAccountsPayload(
  accounts: readonly ResetDepartmentAccountSnapshot[]
): string {
  const ids = new Set<string>();
  return JSON.stringify(
    [...accounts]
      .sort((a, b) => a._id.localeCompare(b._id))
      .map((account) => {
        if (
          ids.has(account._id) ||
          account._id !== `${account.countryId}:${account.departmentId}` ||
          !Number.isSafeInteger(account.sourceTurn) ||
          account.accruedThroughTurn !== account.sourceTurn ||
          account.lastAuthorityPaid !== 0 ||
          (account.unpaidAuthority ?? 0) !== 0 ||
          !Number.isSafeInteger(account.grossAnnualClaim) ||
          !Number.isSafeInteger(account.grantReservation) ||
          !Number.isFinite(account.annualAuthority) ||
          account.annualAuthority < 0 ||
          account.grossAnnualClaim !== account.annualAuthority + account.grantReservation ||
          account.balance !== 0 ||
          account.encumbered !== 0 ||
          account.arrears !== 0 ||
          Object.keys(account.lastProgramDelivery).length !== 0 ||
          Object.values(account.familyAnnualDemand).reduce((sum, amount) => sum + amount, 0) !==
            account.annualAuthority ||
          Object.values(account.familyGrossAnnualDemand).reduce(
            (sum, amount) => sum + amount,
            0
          ) !== account.grossAnnualClaim ||
          Object.values(account.familyGrantReservation).reduce((sum, amount) => sum + amount, 0) !==
            account.grantReservation ||
          Object.entries(account.familyGrossAnnualDemand).some(
            ([familyId, amount]) =>
              amount !==
              (account.familyAnnualDemand[familyId] ?? 0) +
                (account.familyGrantReservation[familyId] ?? 0)
          )
        ) {
          throw new Error(`Invalid live department opening ${account._id}`);
        }
        ids.add(account._id);
        return [
          account._id,
          account.worldId,
          account.countryId,
          account.departmentId,
          account.controllingSeatId,
          [...account.openingAgencyNames].sort(),
          account.sourceTurn,
          account.accruedThroughTurn,
          account.lastAuthorityPaid,
          account.grossAnnualClaim,
          account.grantReservation,
          account.annualAuthority,
          account.balance,
          account.encumbered,
          account.arrears,
          account.externallySettled,
          Object.entries(account.familyGrossAnnualDemand).sort(([a], [b]) => a.localeCompare(b)),
          Object.entries(account.familyGrantReservation).sort(([a], [b]) => a.localeCompare(b)),
          Object.entries(account.familyAnnualDemand).sort(([a], [b]) => a.localeCompare(b)),
          Object.entries(account.programAllocationPercents).sort(([a], [b]) => a.localeCompare(b)),
          Object.entries(account.lastProgramDelivery).sort(([a], [b]) => a.localeCompare(b)),
        ];
      })
  );
}
