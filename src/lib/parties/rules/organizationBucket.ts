import {
  ORG_BUCKET_BASELINE_UNITS,
  ORG_BUILD_UNITS_PER_CLICK,
  ORG_DECAY_GRACE_TURNS,
  ORG_LEGACY_UNITS_PER_PERCENT_MAX,
  ORG_UNIT_DECAY_RATE,
} from "@/lib/constants/partyOrg";

export interface OrganizationBucketRow {
  id: string;
  organization: number;
  organizationUnits?: number;
  lastOrganizationBuildTurn?: number;
}

export interface ResolvedOrganizationBucketRow {
  id: string;
  organization: number;
  organizationUnits: number;
  lastOrganizationBuildTurn?: number;
}

export interface OrganizationShareChange extends ResolvedOrganizationBucketRow {
  previousOrganization: number;
  delta: number;
}

export interface OrganizationBucketResult {
  rows: OrganizationShareChange[];
  totalUnits: number;
  denominatorUnits: number;
  /** Permanent non-decaying stake held by Unaffiliated. */
  unaffiliatedUnits: number;
}

function nonNegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function roundUnits(value: number): number {
  return Math.round(nonNegative(value) * 1_000_000) / 1_000_000;
}

function roundShare(value: number): number {
  return Math.round(nonNegative(value) * 10_000) / 10_000;
}

function roundShareDelta(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 10_000) / 10_000;
}

/**
 * Legacy rows predate contribution units. Treat their current Org percentage
 * as their initial unit balance. Regional scaling preserves visible shares
 * exactly where possible, with a cap for nearly or fully allocated regions.
 */
export function resolveOrganizationUnits(
  row: Pick<OrganizationBucketRow, "organization" | "organizationUnits">,
  legacyScale = ORG_LEGACY_UNITS_PER_PERCENT_MAX
): number {
  return roundUnits(
    Number.isFinite(row.organizationUnits)
      ? (row.organizationUnits as number)
      : nonNegative(row.organization) * legacyScale
  );
}

function legacyScaleFor(rows: readonly OrganizationBucketRow[]): number {
  const existingUnits = rows.reduce(
    (sum, row) =>
      Number.isFinite(row.organizationUnits)
        ? sum + resolveOrganizationUnits(row, ORG_LEGACY_UNITS_PER_PERCENT_MAX)
        : sum,
    0
  );
  const legacyOrganization = rows.reduce(
    (sum, row) =>
      Number.isFinite(row.organizationUnits) ? sum : sum + nonNegative(row.organization),
    0
  );
  if (legacyOrganization <= 0) return 1;
  const exactScale =
    (ORG_BUCKET_BASELINE_UNITS + existingUnits) /
    Math.max(1, 100 - Math.min(99, legacyOrganization));
  return Math.min(ORG_LEGACY_UNITS_PER_PERCENT_MAX, exactScale);
}

/** Derive cached Org percentages from durable contribution-unit balances. */
export function deriveOrganizationShares(
  rows: readonly OrganizationBucketRow[]
): OrganizationBucketResult {
  const legacyScale = legacyScaleFor(rows);
  const resolved = rows.map((row) => ({
    ...row,
    organizationUnits: resolveOrganizationUnits(row, legacyScale),
  }));
  const totalUnits = roundUnits(resolved.reduce((sum, row) => sum + row.organizationUnits, 0));
  const denominatorUnits = roundUnits(ORG_BUCKET_BASELINE_UNITS + totalUnits);
  const unaffiliatedUnits = ORG_BUCKET_BASELINE_UNITS;

  return {
    rows: resolved.map((row) => {
      const organization = roundShare((row.organizationUnits / denominatorUnits) * 100);
      const previousOrganization = roundShare(row.organization);
      return {
        ...row,
        organization,
        previousOrganization,
        delta: roundShareDelta(organization - previousOrganization),
      };
    }),
    totalUnits,
    denominatorUnits,
    unaffiliatedUnits,
  };
}

/**
 * Deposit the fixed contribution for one successful Build Org action and
 * recompute every party's share in the region.
 */
export function applyOrganizationBuild(
  rows: readonly OrganizationBucketRow[],
  partyRowId: string,
  currentTurn: number
): OrganizationBucketResult {
  if (!rows.some((row) => row.id === partyRowId)) {
    throw new Error(`Organization bucket row not found: ${partyRowId}`);
  }

  const before = deriveOrganizationShares(rows);
  const beforeById = new Map(before.rows.map((row) => [row.id, row]));
  const result = deriveOrganizationShares(
    before.rows.map((row) =>
      row.id === partyRowId
        ? {
            ...row,
            organizationUnits: row.organizationUnits + ORG_BUILD_UNITS_PER_CLICK,
            lastOrganizationBuildTurn: currentTurn,
          }
        : row
    )
  );
  return {
    ...result,
    rows: result.rows.map((row) => {
      const previousOrganization = beforeById.get(row.id)?.organization ?? 0;
      return {
        ...row,
        previousOrganization,
        delta: roundShareDelta(row.organization - previousOrganization),
      };
    }),
  };
}

/**
 * Decay inactive contribution balances, then recompute all regional shares.
 * Missing clocks are legacy rows: bootstrap their clock to the current turn so
 * deployment itself never causes an immediate decay cliff.
 */
export function applyOrganizationDecay(
  rows: readonly OrganizationBucketRow[],
  currentTurn: number
): OrganizationBucketResult {
  const legacyScale = legacyScaleFor(rows);
  const decayedRows = rows.map((row) => {
    const organizationUnits = resolveOrganizationUnits(row, legacyScale);
    const lastOrganizationBuildTurn = Number.isFinite(row.lastOrganizationBuildTurn)
      ? (row.lastOrganizationBuildTurn as number)
      : currentTurn;
    const isDecaying =
      currentTurn - lastOrganizationBuildTurn >= ORG_DECAY_GRACE_TURNS && organizationUnits > 0;

    return {
      ...row,
      organizationUnits: isDecaying
        ? roundUnits(organizationUnits * (1 - ORG_UNIT_DECAY_RATE))
        : organizationUnits,
      lastOrganizationBuildTurn,
    };
  });

  return deriveOrganizationShares(decayedRows);
}
