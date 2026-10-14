/** Independence divides live cash and authority without creating new working capital. */
import type {
  ResetDepartmentContinuitySnapshot,
  ResetDepartmentAccountSnapshot,
} from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetNationalTreasurySnapshot } from "@/lib/resetFinance/rules/treasurySnapshot";
import type { DepartmentDefinition } from "@/lib/governmentFinance/departmentCatalog";

export function splitLiveDepartmentAccounts(
  source: ResetDepartmentAccountSnapshot[],
  successors: ResetDepartmentAccountSnapshot[],
  definitions: readonly DepartmentDefinition[],
  weight: number,
  turn: number
) {
  if (!Number.isFinite(weight) || weight <= 0 || weight >= 1)
    throw new Error("Invalid live finance allocation");
  const kept = structuredClone(source);
  const moved = structuredClone(successors);
  const idMap: Record<string, string> = {};
  const scalars = [
    "lastAuthorityPaid",
    "unpaidAuthority",
    "grossAnnualClaim",
    "grantReservation",
    "annualAuthority",
    "balance",
    "encumbered",
    "arrears",
  ] as const;
  const maps = ["familyGrossAnnualDemand", "familyGrantReservation", "familyAnnualDemand"] as const;
  for (const row of moved) {
    for (const key of scalars) row[key] = 0;
    for (const key of maps) row[key] = {};
    row.accruedThroughTurn = turn;
    row.lastProgramDelivery = {};
    row.programAllocationPercents = {};
  }
  for (const row of kept) {
    if (row.accruedThroughTurn !== turn)
      throw new Error("Source department and treasury turns disagree");
    const definition = definitions.find(
      (item) => item.id === row.departmentId && item.countryId === row.countryId
    );
    const target =
      moved.find((item) =>
        definitions.some(
          (candidate) =>
            candidate.id === item.departmentId &&
            candidate.countryId === item.countryId &&
            candidate.portfolioIds.some((portfolio) => definition?.portfolioIds.includes(portfolio))
        )
      ) ?? moved.find((item) => !item.externallySettled);
    if (!target) throw new Error("Successor has no account for live funds");
    idMap[row._id] = target._id;
    for (const key of scalars) {
      if (row[key] === undefined) continue;
      // Existing UK actions retain their earmarked funds; only free working cash moves.
      const base =
        key === "balance"
          ? Math.max(0, row.balance - row.encumbered)
          : key === "encumbered"
            ? 0
            : row[key]!;
      const amount = Math.floor(base * weight);
      target[key] = (target[key] ?? 0) + amount;
      row[key] = row[key]! - amount;
    }
    for (const key of maps)
      for (const [family, value] of Object.entries(row[key])) {
        const amount = Math.floor(value * weight);
        target[key][family] = (target[key][family] ?? 0) + amount;
        row[key][family] = value - amount;
      }
    for (const [family, delivery] of Object.entries(row.lastProgramDelivery)) {
      const requested = Math.floor(delivery.requested * weight);
      const outlaid = Math.floor(delivery.outlaid * weight);
      const previous = target.lastProgramDelivery[family];
      const combinedRequested = (previous?.requested ?? 0) + requested;
      const combinedOutlaid = (previous?.outlaid ?? 0) + outlaid;
      target.lastProgramDelivery[family] = {
        requested: combinedRequested,
        outlaid: combinedOutlaid,
        implementationFactor:
          combinedRequested > 0
            ? combinedOutlaid / combinedRequested
            : delivery.implementationFactor,
      };
      row.lastProgramDelivery[family] = {
        requested: delivery.requested - requested,
        outlaid: delivery.outlaid - outlaid,
        implementationFactor: delivery.implementationFactor,
      };
    }
    target.programAllocationPercents = {
      ...target.programAllocationPercents,
      ...row.programAllocationPercents,
    };
  }
  for (const row of [...kept, ...moved]) {
    row.annualAuthority = Object.values(row.familyAnnualDemand).reduce(
      (sum, value) => sum + value,
      0
    );
    row.grossAnnualClaim = Object.values(row.familyGrossAnnualDemand).reduce(
      (sum, value) => sum + value,
      0
    );
    row.grantReservation = Object.values(row.familyGrantReservation).reduce(
      (sum, value) => sum + value,
      0
    );
  }
  // Cabinet requests are independent whole percents of each law family's
  // enacted claim (0 to 200), not shares that sum to 100. Carry them over as
  // they are; rescaling halved every request and produced fractional values
  // the allocation rules reject.
  return { kept, moved, idMap };
}

export function splitLiveTreasury(
  source: ResetNationalTreasurySnapshot,
  successor: ResetNationalTreasurySnapshot,
  weight: number,
  turn: number,
  idMap: Record<string, string> = {}
) {
  if (!Number.isFinite(weight) || weight <= 0 || weight >= 1)
    throw new Error("Invalid live finance allocation");
  const kept = structuredClone(source);
  const moved = structuredClone(successor);
  for (const key of ["cash", "debt", "debtCeiling", "emergencyAdvance"] as const) {
    moved[key] = source[key] * weight;
    kept[key] = source[key] - moved[key];
  }
  for (const key of ["arrears", "claimArrears", "lastPaid", "lastPaidByClaim"] as const) {
    const values = source[key];
    if (!values) continue;
    const movedMap: Record<string, number> = {};
    const keptMap: Record<string, number> = {};
    for (const [id, value] of Object.entries(values)) {
      const targetId = idMap[id] ?? id.replace(/^UK:/, `${successor.countryId}:`);
      const amount = Math.floor(value * weight);
      movedMap[targetId] = (movedMap[targetId] ?? 0) + amount;
      keptMap[id] = value - amount;
    }
    Object.assign(moved, { [key]: movedMap });
    Object.assign(kept, { [key]: keptMap });
  }
  moved.settledThroughTurn = source.settledThroughTurn;
  if (moved.settledThroughTurn < turn - 1 || moved.settledThroughTurn > turn)
    throw new Error("Source treasury is not current at independence");
  return { kept, moved };
}

export function reconcileSplitTreasuryClaims(
  source: ResetNationalTreasurySnapshot,
  kept: ResetNationalTreasurySnapshot,
  moved: ResetNationalTreasurySnapshot,
  accounts: ResetDepartmentAccountSnapshot[],
  sourceAccounts: ResetDepartmentAccountSnapshot[]
) {
  const sourceCategories = new Map(
    sourceAccounts.map((account) => [
      account._id,
      account.externallySettled ? "mandatory" : "existing",
    ])
  );
  sourceCategories.set(`${source.countryId}:continuity`, "existing");
  sourceCategories.set(`${source.countryId}:grants`, "grants");
  const categories = new Map(
    accounts.map((account) => [account._id, account.externallySettled ? "mandatory" : "existing"])
  );
  categories.set(`${moved.countryId}:continuity`, "existing");
  categories.set(`${moved.countryId}:grants`, "grants");
  for (const key of ["arrears", "lastPaid"] as const) {
    const detail = key === "arrears" ? moved.claimArrears : moved.lastPaidByClaim;
    if (!detail || !source[key]) continue;
    for (const category of ["mandatory", "existing", "grants"] as const) {
      const amount = Object.entries(detail).reduce(
        (sum, [id, value]) => sum + (categories.get(id) === category ? value : 0),
        0
      );
      moved[key]![category] = amount;
      const originalDetail = key === "arrears" ? source.claimArrears : source.lastPaidByClaim;
      const retainedDetail = key === "arrears" ? kept.claimArrears : kept.lastPaidByClaim;
      const removed = Object.entries(originalDetail ?? {}).reduce(
        (sum, [id, value]) =>
          sum + (sourceCategories.get(id) === category ? value - (retainedDetail?.[id] ?? 0) : 0),
        0
      );
      kept[key]![category] = source[key]![category] - removed;
    }
  }
  for (const account of accounts) {
    (moved.lastPaidByClaim ??= {})[account._id] ??= 0;
    account.unpaidAuthority = moved.claimArrears?.[account._id] ?? 0;
  }
}

export function splitLiveContinuity(
  source: ResetDepartmentContinuitySnapshot,
  successor: ResetDepartmentContinuitySnapshot,
  weight: number
) {
  if (!Number.isFinite(weight) || weight <= 0 || weight >= 1)
    throw new Error("Invalid continuity allocation");
  const kept = { ...source },
    moved = { ...successor };
  for (const key of ["grossAnnualClaim", "grantReservation", "annualAuthority"] as const) {
    moved[key] = Math.floor(source[key] * weight);
    kept[key] = source[key] - moved[key];
  }
  return { kept, moved };
}
