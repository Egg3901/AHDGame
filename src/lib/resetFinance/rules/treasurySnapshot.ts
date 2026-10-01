import type { NationalClaims, NationalTreasuryState } from "./settlement";

export type ResetTreasuryCountry = "US" | "UK" | "JP";

/** A world-bound cash ledger, separate from the legacy signed budget balance. */
export interface ResetNationalTreasurySnapshot extends NationalTreasuryState {
  _id: ResetTreasuryCountry;
  worldId: string;
  countryId: ResetTreasuryCountry;
  sourceTurn: number;
  settledThroughTurn: number;
  /** Seeded account identities cannot silently disappear from a live cash roster. */
  departmentAccountIds?: string[];
  lastPaid?: NationalClaims;
  lastEmergencyAdvanceDrawn?: number;
  /** Individually owed authority; category totals must match treasury arrears. */
  claimArrears?: Record<string, number>;
  lastPaidByClaim?: Record<string, number>;
  fiscalCrisis?: { sinceTurn: number; reason: "emergency_advance" | "debt_ceiling" };
}

export function openingNationalTreasurySnapshots(
  worldId: string,
  sourceTurn: number,
  books: Readonly<Record<ResetTreasuryCountry, { debt: number; debtCeiling: number }>>,
  accounts?: readonly { _id: string; countryId: ResetTreasuryCountry }[]
): ResetNationalTreasurySnapshot[] {
  if (!worldId || !Number.isSafeInteger(sourceTurn) || sourceTurn < 1) {
    throw new Error("Invalid national treasury opening identity");
  }
  return (["US", "UK", "JP"] as const).map((countryId) => ({
    _id: countryId,
    worldId,
    countryId,
    sourceTurn,
    settledThroughTurn: sourceTurn,
    cash: 0,
    debt: books[countryId].debt,
    debtCeiling: books[countryId].debtCeiling,
    emergencyAdvance: 0,
    arrears: { interest: 0, mandatory: 0, grants: 0, existing: 0, new: 0 },
    ...(accounts
      ? {
          departmentAccountIds: accounts
            .filter((account) => account.countryId === countryId)
            .map((account) => account._id)
            .sort(),
        }
      : {}),
  }));
}

export function openingNationalTreasuryPayload(
  rows: readonly ResetNationalTreasurySnapshot[]
): string {
  if (rows.length !== 3) throw new Error("National treasury opening needs three countries");
  const ids = new Set<string>();
  const worldId = rows[0]?.worldId;
  const sourceTurn = rows[0]?.sourceTurn;
  return JSON.stringify(
    [...rows]
      .sort((left, right) => left._id.localeCompare(right._id))
      .map((row) => {
        if (
          ids.has(row._id) ||
          row._id !== row.countryId ||
          !(["US", "UK", "JP"] as string[]).includes(row.countryId) ||
          !row.worldId ||
          row.worldId !== worldId ||
          !Number.isSafeInteger(row.sourceTurn) ||
          row.sourceTurn < 1 ||
          row.sourceTurn !== sourceTurn ||
          row.settledThroughTurn !== row.sourceTurn ||
          row.cash !== 0 ||
          row.emergencyAdvance !== 0 ||
          !Number.isFinite(row.debt) ||
          row.debt < 0 ||
          !Number.isFinite(row.debtCeiling) ||
          row.debtCeiling < 0 ||
          Object.values(row.arrears).some((value) => value !== 0) ||
          row.lastPaid !== undefined ||
          row.lastEmergencyAdvanceDrawn !== undefined ||
          row.claimArrears !== undefined ||
          row.lastPaidByClaim !== undefined ||
          row.fiscalCrisis !== undefined
        ) {
          throw new Error(`Invalid national treasury opening ${row._id}`);
        }
        ids.add(row._id);
        if (
          row.departmentAccountIds &&
          (new Set(row.departmentAccountIds).size !== row.departmentAccountIds.length ||
            row.departmentAccountIds.some(
              (id) => !id.startsWith(`${row.countryId}:`) || id.length <= 3
            ))
        )
          throw new Error(`Invalid opening department roster ${row._id}`);
        return [
          row._id,
          row.worldId,
          row.sourceTurn,
          row.settledThroughTurn,
          row.cash,
          row.debt,
          row.debtCeiling,
          row.emergencyAdvance,
          row.arrears,
          row.departmentAccountIds,
        ];
      })
  );
}
